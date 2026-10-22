import { avatarFromId } from '../../src/avatar/parts'
import {
  generateCode,
  LIMITS,
  normalizeName,
  PROTOCOL_VERSION,
  parseClientMessage,
  publicName,
  type Crowd,
  type ErrorReason,
  type FocusStatus,
  type FriendInfo,
  type Presence,
  type PublicMode,
  type PublicWalker,
  type RegisterResponse,
  type SelfInfo,
  type ServerMessage,
  type SharedStation,
} from '../../src/social/protocol'

/**
 * Presence hub logic, independent of the Durable Object runtime so it can be
 * tested in Node: accounts, the friend graph, per-socket sessions, fan-out to
 * friends, and the public world everyone sees.
 */

export interface UserRow {
  id: string
  code: string
  name: string
  tokenHash: string
}

/** The public world as last sent: each walker's JSON by pid, so the next tick can diff. */
export interface WorldState {
  walkers: Record<string, string>
  crowds: string
  online: number
}

/** Durable storage for users, friendships and the last world (SQLite in the Worker, a Map in tests). */
export interface Repo {
  createUser(user: UserRow): void
  userById(id: string): UserRow | null
  userByCode(code: string): UserRow | null
  userByTokenHash(hash: string): UserRow | null
  rename(id: string, name: string): void
  friendsOf(id: string): string[]
  addFriendship(a: string, b: string): void
  removeFriendship(a: string, b: string): void
  loadWorld(): WorldState | null
  saveWorld(world: WorldState): void
}

export interface Socket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

/** Presence as the server keeps it: focus deadlines on the server clock. */
export interface StoredPresence {
  avatar: Presence['avatar']
  station: SharedStation | null
  focus: { phase: FocusStatus['phase']; endsAt: number; paused: boolean; remainingMs: number } | null
}

export interface Session {
  userId: string | null
  /** Connected without a profile: may only publish presence and pick a public mode */
  guest: boolean
  /** Random per connection; the only id strangers ever see */
  pid: string
  invisible: boolean
  publicMode: PublicMode
  /** Protocol version the client speaks */
  version: number
  presence: StoredPresence | null
  updatedAt: number
  /** Recent addFriend attempts, for rate limiting */
  adds: number[]
  /** Recent presence messages, for rate limiting */
  presences: number[]
  ip: string
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
const PRESENCE_LIMIT = { count: 10, windowMs: 10_000 }
const GUESTS_PER_IP = 3
/** The public world is sent at most this often, and only when it changed. */
export const WORLD_TICK_MS = 3000

const base64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return base64url(new Uint8Array(digest))
}

const newPid = () => base64url(crypto.getRandomValues(new Uint8Array(9)))

export const newSession = (now: number, ip = 'unknown'): Session => ({
  userId: null, guest: false, pid: newPid(), invisible: false, publicMode: 'hidden', version: 1,
  presence: null, updatedAt: now, adds: [], presences: [], ip,
})

/** Sessions stored before a field existed get its default (and a pid of their own). */
export function upgradeSession(raw: Partial<Session> | null): Session | null {
  if (!raw) return null
  return raw.pid ? (raw as Session) : { ...newSession(raw.updatedAt ?? 0), ...raw, pid: newPid() }
}

export class Hub<S extends Socket> {
  private repo: Repo
  private sessions: Sessions<S>
  private schedule: (at: number) => void
  private registrations = new Map<string, number[]>()
  private lastTick = 0

  /** `schedule` asks for `tick()` to run at a time (a Durable Object alarm in the Worker). */
  constructor(repo: Repo, sessions: Sessions<S>, schedule: (at: number) => void = () => {}) {
    this.repo = repo
    this.sessions = sessions
    this.schedule = schedule
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
      // A guest socket becomes this user's (signing up keeps the connection)
      this.sessions.set(ws, { ...session, userId: user.id, guest: false, invisible: msg.invisible, version: msg.v, publicMode: msg.public, updatedAt: now })
      this.send(ws, {
        type: 'welcome',
        v: PROTOCOL_VERSION,
        self: this.selfInfo(user),
        friends: this.repo.friendsOf(user.id).flatMap((id) => this.friendInfo(id, now) ?? []),
      })
      if (msg.v >= 2) this.sendSnapshot(ws)
      if (wasVisible !== this.isVisible(user.id)) this.broadcastUser(user.id, now)
      this.requestTick(now)
      return
    }
    if (msg.type === 'guest') {
      if (session.userId) return this.error(ws, 'invalid', 'Already signed in')
      const guests = this.sessions.all().filter((other) => {
        const s = other !== ws ? this.sessions.get(other) : null
        return s?.guest && s.ip === session.ip
      })
      if (guests.length >= GUESTS_PER_IP) {
        this.error(ws, 'limit', 'Too many guest connections from this network')
        ws.close(4002, 'limit')
        return
      }
      this.sessions.set(ws, { ...session, guest: true, version: msg.v, publicMode: msg.public, updatedAt: now })
      if (msg.v >= 2) this.sendSnapshot(ws)
      this.requestTick(now)
      return
    }

    const userId = session.userId
    if (!userId && !(session.guest && (msg.type === 'presence' || msg.type === 'world'))) {
      this.error(ws, 'auth', 'Say hello first')
      ws.close(4001, 'auth')
      return
    }

    switch (msg.type) {
      case 'presence': {
        const presences = session.presences.filter((t) => now - t < PRESENCE_LIMIT.windowMs)
        // Clients send at most one a second; a flood is dropped rather than relayed
        if (presences.length >= PRESENCE_LIMIT.count) return
        this.sessions.set(ws, { ...session, presence: storePresence(msg.presence, now), presences: [...presences, now], updatedAt: now })
        if (userId && !session.invisible) this.broadcastUser(userId, now)
        this.requestTick(now)
        break
      }
      case 'world':
        this.sessions.set(ws, { ...session, publicMode: session.guest && msg.mode === 'named' ? 'anonymous' : msg.mode })
        this.requestTick(now)
        break
      case 'invisible':
        this.sessions.set(ws, { ...session, invisible: msg.invisible, updatedAt: now })
        this.broadcastUser(userId!, now)
        this.requestTick(now)
        break
      case 'rename': {
        this.repo.rename(userId!, msg.name)
        const self = this.repo.userById(userId!)
        if (self) this.sendToUser(userId!, { type: 'self', self: this.selfInfo(self) })
        this.broadcastUser(userId!, now)
        this.requestTick(now)
        break
      }
      case 'addFriend': {
        const adds = session.adds.filter((t) => now - t < ADD_LIMIT.windowMs)
        if (adds.length >= ADD_LIMIT.count) return this.error(ws, 'rate', 'Slow down a little')
        this.sessions.set(ws, { ...session, adds: [...adds, now] })
        const other = this.repo.userByCode(msg.code)
        if (!other) return this.error(ws, 'not-found', 'No one has that code')
        if (other.id === userId) return this.error(ws, 'self', "That's your own code")
        const mine = this.repo.friendsOf(userId!)
        if (mine.includes(other.id)) return this.sendFriend(ws, other.id, now)
        if (mine.length >= LIMITS.maxFriends || this.repo.friendsOf(other.id).length >= LIMITS.maxFriends) {
          return this.error(ws, 'limit', 'Friend list is full')
        }
        // Codes act as invites: adding is mutual and immediate
        this.repo.addFriendship(userId!, other.id)
        this.sendFriendToUser(userId!, other.id, now)
        this.sendFriendToUser(other.id, userId!, now)
        break
      }
      case 'removeFriend':
        this.repo.removeFriendship(userId!, msg.userId)
        this.sendToUser(userId!, { type: 'friendRemoved', userId: msg.userId })
        this.sendToUser(msg.userId, { type: 'friendRemoved', userId: userId! })
        break
    }
  }

  /** Socket gone: drop it, tell friends if that was the user's last visible tab, and update the world. */
  close(ws: S, now: number) {
    const session = this.sessions.get(ws)
    if (!session || (!session.userId && !session.guest)) return
    const wasVisible = session.userId ? this.isVisible(session.userId) : false
    this.sessions.set(ws, { ...session, userId: null, guest: false })
    if (session.userId && wasVisible !== this.isVisible(session.userId, ws)) this.broadcastUser(session.userId, now, ws)
    this.requestTick(now)
  }

  /** Send everyone what changed in the public world since the last tick. */
  tick(now: number) {
    this.lastTick = now
    const world = this.buildWorld()
    const prev = this.repo.loadWorld() ?? { walkers: {}, crowds: '[]', online: 0 }
    const next: WorldState = {
      walkers: Object.fromEntries(world.walkers.map((w) => [w.pid, JSON.stringify(w)])),
      crowds: JSON.stringify(world.crowds),
      online: world.online,
    }
    const upsert = world.walkers.filter((w) => prev.walkers[w.pid] !== next.walkers[w.pid])
    const remove = Object.keys(prev.walkers).filter((pid) => !(pid in next.walkers))
    if (!upsert.length && !remove.length && prev.crowds === next.crowds && prev.online === next.online) return
    this.repo.saveWorld(next)
    const frame = JSON.stringify({ type: 'worldDelta', upsert, remove, crowds: world.crowds, online: world.online } satisfies ServerMessage)
    for (const ws of this.sessions.all()) {
      const s = this.sessions.get(ws)
      if (s && (s.userId || s.guest) && s.version >= 2) this.sendRaw(ws, frame)
    }
  }

  private requestTick(now: number) {
    this.schedule(Math.max(now, this.lastTick + WORLD_TICK_MS))
  }

  /** New connections get the world as of the last tick, so later deltas apply cleanly. */
  private sendSnapshot(ws: S) {
    const world = this.repo.loadWorld()
    this.send(ws, {
      type: 'worldSnapshot',
      pid: this.sessions.get(ws)!.pid,
      walkers: world ? Object.values(world.walkers).map((json) => JSON.parse(json) as PublicWalker) : [],
      crowds: world ? (JSON.parse(world.crowds) as Crowd[]) : [],
      online: world?.online ?? 0,
    })
  }

  /** Each person's most recently active visible tab: the one friends see too. */
  private primaries(): Session[] {
    const best = new Map<string, Session>()
    for (const ws of this.sessions.all()) {
      const s = this.sessions.get(ws)
      if (!s || s.invisible) continue
      const key = s.userId ?? (s.guest ? `g:${s.pid}` : null)
      if (!key) continue
      const current = best.get(key)
      if (!current || s.updatedAt > current.updatedAt) best.set(key, s)
    }
    return [...best.values()]
  }

  /**
   * Everyone in the public world: at most `walkersPerStation` per station and
   * `maxWalkers` overall (most recently active first); the rest are counted in crowds.
   */
  buildWorld(): { walkers: PublicWalker[]; crowds: Crowd[]; online: number } {
    const present = this.primaries().filter((s) => s.version >= 2 && s.publicMode !== 'hidden')
    const byStation = new Map<string, Session[]>()
    for (const s of present) {
      const st = s.presence?.station
      if (!st || st.lat === null || st.lon === null) continue
      byStation.set(st.id, [...(byStation.get(st.id) ?? []), s])
    }
    const recent = (a: Session, b: Session) => b.updatedAt - a.updatedAt || a.pid.localeCompare(b.pid)
    const crowds: Crowd[] = [...byStation.entries()]
      .map(([id, group]) => {
        const st = [...group].sort(recent)[0].presence!.station!
        return { stationId: id, name: st.name, location: st.location, lat: st.lat!, lon: st.lon!, count: group.length }
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, LIMITS.maxCrowds)
    const walkers = [...byStation.values()]
      .flatMap((group) => [...group].sort(recent).slice(0, LIMITS.walkersPerStation))
      .sort(recent)
      .slice(0, LIMITS.maxWalkers)
      .map((s) => this.walkerOf(s))
    return { walkers, crowds, online: present.length }
  }

  private walkerOf(s: Session): PublicWalker {
    const st = s.presence!.station!
    const user = s.publicMode === 'named' && s.userId ? this.repo.userById(s.userId) : null
    return {
      pid: s.pid,
      name: user ? publicName(user.name) : null,
      avatar: s.presence!.avatar ?? avatarFromId(s.userId ?? s.pid),
      station: { id: st.id, name: st.name, song: st.song, location: st.location, lat: st.lat!, lon: st.lon! },
      focus: s.presence!.focus?.phase ?? null,
    }
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
    return {
      ...this.selfInfo(user),
      online,
      presence: online ? wirePresence(visible[0].presence, now) : null,
      pid: online ? visible[0].pid : null,
    }
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
    this.sendRaw(ws, JSON.stringify(msg))
  }

  private sendRaw(ws: S, frame: string) {
    try {
      ws.send(frame)
    } catch {
      // Socket already closing; its close handler cleans up
    }
  }
}

function storePresence(p: Presence, now: number): StoredPresence {
  return {
    avatar: p.avatar,
    station: p.station,
    focus: p.focus ? { phase: p.focus.phase, paused: p.focus.paused, remainingMs: p.focus.remainingMs, endsAt: now + p.focus.remainingMs } : null,
  }
}

/** Re-express focus deadlines as time left, so clients never compare clocks. */
function wirePresence(p: StoredPresence | null, now: number): Presence {
  if (!p) return { station: null, focus: null, avatar: null }
  const focus = p.focus
    ? { phase: p.focus.phase, paused: p.focus.paused, remainingMs: p.focus.paused ? p.focus.remainingMs : Math.max(0, p.focus.endsAt - now) }
    : null
  return { station: p.station, focus, avatar: p.avatar ?? null }
}
