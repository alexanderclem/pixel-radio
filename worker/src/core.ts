import {
  generateCode,
  LIMITS,
  normalizeName,
  parseClientMessage,
  type ErrorReason,
  type FocusStatus,
  type FriendInfo,
  type Presence,
  type RegisterResponse,
  type SelfInfo,
  type ServerMessage,
  type SharedStation,
} from '../../src/social/protocol'

/**
 * Presence hub logic, independent of the Durable Object runtime so it can be
 * tested in Node: accounts, the friend graph, per-socket sessions and fan-out.
 */

export interface UserRow {
  id: string
  code: string
  name: string
  tokenHash: string
}

/** Durable storage for users and friendships (SQLite in the Worker, a Map in tests). */
export interface Repo {
  createUser(user: UserRow): void
  userById(id: string): UserRow | null
  userByCode(code: string): UserRow | null
  userByTokenHash(hash: string): UserRow | null
  rename(id: string, name: string): void
  friendsOf(id: string): string[]
  addFriendship(a: string, b: string): void
  removeFriendship(a: string, b: string): void
}

export interface Socket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

/** Presence as the server keeps it: focus deadlines on the server clock. */
export interface StoredPresence {
  station: SharedStation | null
  focus: { phase: FocusStatus['phase']; endsAt: number; paused: boolean; remainingMs: number } | null
}

export interface Session {
  userId: string | null
  invisible: boolean
  presence: StoredPresence | null
  updatedAt: number
  /** Recent addFriend attempts, for rate limiting */
  adds: number[]
}

/** Where per-socket sessions live (WebSocket attachments in the Worker, so they survive hibernation). */
export interface Sessions<S extends Socket> {
  get(ws: S): Session | null
  set(ws: S, session: Session): void
  all(): S[]
}

export class HubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const ADD_LIMIT = { count: 20, windowMs: 60_000 }
const REGISTER_LIMIT = { count: 10, windowMs: 60 * 60_000 }

const base64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return base64url(new Uint8Array(digest))
}

export const newSession = (now: number): Session => ({ userId: null, invisible: false, presence: null, updatedAt: now, adds: [] })

export class Hub<S extends Socket> {
  private repo: Repo
  private sessions: Sessions<S>
  private registrations = new Map<string, number[]>()

  constructor(repo: Repo, sessions: Sessions<S>) {
    this.repo = repo
    this.sessions = sessions
  }

  async register(rawName: unknown, ip: string, now: number): Promise<RegisterResponse> {
    const name = normalizeName(rawName)
    if (!name) throw new HubError(400, 'Pick a nickname')
    const recent = (this.registrations.get(ip) ?? []).filter((t) => now - t < REGISTER_LIMIT.windowMs)
    if (recent.length >= REGISTER_LIMIT.count) throw new HubError(429, 'Too many new profiles from this network, try later')
    this.registrations.set(ip, [...recent, now])
    // Forget idle networks so the map can't grow without bound
    if (this.registrations.size > 10_000) this.registrations.clear()

    let code = generateCode()
    while (this.repo.userByCode(code)) code = generateCode()
    const token = base64url(crypto.getRandomValues(new Uint8Array(32)))
    const user: UserRow = { id: crypto.randomUUID(), code, name, tokenHash: await hashToken(token) }
    this.repo.createUser(user)
    return { userId: user.id, name, code, token }
  }

  async message(ws: S, raw: unknown, now: number) {
    const session = this.sessions.get(ws) ?? newSession(now)
    const msg = parseClientMessage(typeof raw === 'string' ? raw : null)
    if (!msg) return this.error(ws, 'invalid', 'Malformed message')

    if (msg.type === 'ping') return this.send(ws, { type: 'pong' })
    if (msg.type === 'hello') {
      const user = this.repo.userByTokenHash(await hashToken(msg.token))
      if (!user) {
        this.error(ws, 'auth', 'Unknown profile')
        ws.close(4001, 'auth')
        return
      }
      const wasVisible = this.isVisible(user.id)
      this.sessions.set(ws, { ...session, userId: user.id, invisible: msg.invisible, updatedAt: now })
      this.send(ws, {
        type: 'welcome',
        self: this.selfInfo(user),
        friends: this.repo.friendsOf(user.id).flatMap((id) => this.friendInfo(id, now) ?? []),
      })
      if (wasVisible !== this.isVisible(user.id)) this.broadcastUser(user.id, now)
      return
    }

    const userId = session.userId
    if (!userId) {
      this.error(ws, 'auth', 'Say hello first')
      ws.close(4001, 'auth')
      return
    }

    switch (msg.type) {
      case 'presence':
        this.sessions.set(ws, { ...session, presence: storePresence(msg.presence, now), updatedAt: now })
        if (!session.invisible) this.broadcastUser(userId, now)
        break
      case 'invisible':
        this.sessions.set(ws, { ...session, invisible: msg.invisible, updatedAt: now })
        this.broadcastUser(userId, now)
        break
      case 'rename': {
        this.repo.rename(userId, msg.name)
        const self = this.repo.userById(userId)
        if (self) this.sendToUser(userId, { type: 'self', self: this.selfInfo(self) })
        this.broadcastUser(userId, now)
        break
      }
      case 'addFriend': {
        const adds = session.adds.filter((t) => now - t < ADD_LIMIT.windowMs)
        if (adds.length >= ADD_LIMIT.count) return this.error(ws, 'rate', 'Slow down a little')
        this.sessions.set(ws, { ...session, adds: [...adds, now] })
        const other = this.repo.userByCode(msg.code)
        if (!other) return this.error(ws, 'not-found', 'No one has that code')
        if (other.id === userId) return this.error(ws, 'self', "That's your own code")
        const mine = this.repo.friendsOf(userId)
        if (mine.includes(other.id)) return this.sendFriend(ws, other.id, now)
        if (mine.length >= LIMITS.maxFriends || this.repo.friendsOf(other.id).length >= LIMITS.maxFriends) {
          return this.error(ws, 'limit', 'Friend list is full')
        }
        // Codes act as invites: adding is mutual and immediate
        this.repo.addFriendship(userId, other.id)
        this.sendFriendToUser(userId, other.id, now)
        this.sendFriendToUser(other.id, userId, now)
        break
      }
      case 'removeFriend':
        this.repo.removeFriendship(userId, msg.userId)
        this.sendToUser(userId, { type: 'friendRemoved', userId: msg.userId })
        this.sendToUser(msg.userId, { type: 'friendRemoved', userId })
        break
    }
  }

  /** Socket gone: drop it and tell friends if that was the user's last visible tab. */
  close(ws: S, now: number) {
    const session = this.sessions.get(ws)
    if (!session?.userId) return
    const wasVisible = this.isVisible(session.userId)
    this.sessions.set(ws, { ...session, userId: null })
    if (wasVisible !== this.isVisible(session.userId, ws)) this.broadcastUser(session.userId, now, ws)
  }

  private socketsOf(userId: string, exclude?: S) {
    return this.sessions.all().filter((ws) => ws !== exclude && this.sessions.get(ws)?.userId === userId)
  }

  private isVisible(userId: string, exclude?: S) {
    return this.socketsOf(userId, exclude).some((ws) => !this.sessions.get(ws)!.invisible)
  }

  private selfInfo(user: UserRow): SelfInfo {
    return { userId: user.id, name: user.name, code: user.code }
  }

  private friendInfo(userId: string, now: number, exclude?: S): FriendInfo | null {
    const user = this.repo.userById(userId)
    if (!user) return null
    const visible = this.socketsOf(userId, exclude)
      .map((ws) => this.sessions.get(ws)!)
      .filter((s) => !s.invisible)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const online = visible.length > 0
    return { ...this.selfInfo(user), online, presence: online ? wirePresence(visible[0].presence, now) : null }
  }

  private broadcastUser(userId: string, now: number, exclude?: S) {
    const info = this.friendInfo(userId, now, exclude)
    if (!info) return
    for (const friendId of this.repo.friendsOf(userId)) {
      for (const ws of this.socketsOf(friendId, exclude)) this.send(ws, { type: 'friend', friend: info })
    }
  }

  private sendFriend(ws: S, friendId: string, now: number) {
    const info = this.friendInfo(friendId, now)
    if (info) this.send(ws, { type: 'friend', friend: info })
  }

  private sendFriendToUser(userId: string, friendId: string, now: number) {
    for (const ws of this.socketsOf(userId)) this.sendFriend(ws, friendId, now)
  }

  private sendToUser(userId: string, msg: ServerMessage) {
    for (const ws of this.socketsOf(userId)) this.send(ws, msg)
  }

  private error(ws: S, reason: ErrorReason, message: string) {
    this.send(ws, { type: 'error', reason, message })
  }

  private send(ws: S, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // Socket already closing; its close handler cleans up
    }
  }
}

function storePresence(p: Presence, now: number): StoredPresence {
  return {
    station: p.station,
    focus: p.focus ? { phase: p.focus.phase, paused: p.focus.paused, remainingMs: p.focus.remainingMs, endsAt: now + p.focus.remainingMs } : null,
  }
}

/** Re-express focus deadlines as time left, so clients never compare clocks. */
function wirePresence(p: StoredPresence | null, now: number): Presence {
  if (!p) return { station: null, focus: null }
  const focus = p.focus
    ? { phase: p.focus.phase, paused: p.focus.paused, remainingMs: p.focus.paused ? p.focus.remainingMs : Math.max(0, p.focus.endsAt - now) }
    : null
  return { station: p.station, focus }
}
