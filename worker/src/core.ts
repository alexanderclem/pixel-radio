import {
  generateCode,
  LIMITS,
  normalizeName,
  normalizeUsername,
  parseClientMessage,
  validPassword,
  type ErrorReason,
  type FocusStatus,
  type FriendInfo,
  type LoginResponse,
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

/** Username and password attached to a profile, plus the data it syncs between devices. */
export interface AccountRow {
  userId: string
  username: string
  passHash: string
  salt: string
  iterations: number
  /** JSON blob written by the client; opaque to the server */
  data: string | null
  rev: number
}

/** Durable storage for users, accounts and friendships (SQLite in the Worker, a Map in tests). */
export interface Repo {
  createUser(user: UserRow): void
  userById(id: string): UserRow | null
  userByCode(code: string): UserRow | null
  /** The profile's original token, or any device token added at login */
  userByTokenHash(hash: string): UserRow | null
  addToken(userId: string, hash: string): void
  deleteToken(hash: string): void
  createAccount(account: AccountRow): void
  accountOf(userId: string): AccountRow | null
  accountByUsername(username: string): AccountRow | null
  saveData(userId: string, data: string, rev: number): void
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
  avatar: Presence['avatar']
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
  /** Extra fields for the JSON error response */
  body: Record<string, unknown> | undefined
  constructor(status: number, message: string, body?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.body = body
  }
}

const ADD_LIMIT = { count: 20, windowMs: 60_000 }
const REGISTER_LIMIT = { count: 10, windowMs: 60 * 60_000 }
const LOGIN_LIMIT = { count: 10, windowMs: 15 * 60_000 }
/** The most PBKDF2 iterations Workers' WebCrypto allows */
const PBKDF2_ITERATIONS = 100_000
const BAD_LOGIN = 'Wrong username or password'

const base64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return base64url(new Uint8Array(digest))
}

export async function hashPassword(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return base64url(new Uint8Array(bits))
}

/** Compare without stopping at the first difference. */
const sameString = (a: string, b: string) => {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

const newToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

const parseData = (data: string | null): unknown => {
  try {
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

const field = (body: unknown, key: string): unknown =>
  typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[key] : undefined

export const newSession = (now: number): Session => ({ userId: null, invisible: false, presence: null, updatedAt: now, adds: [] })

export class Hub<S extends Socket> {
  private repo: Repo
  private sessions: Sessions<S>
  private registrations = new Map<string, number[]>()
  private logins = new Map<string, number[]>()

  constructor(repo: Repo, sessions: Sessions<S>) {
    this.repo = repo
    this.sessions = sessions
  }

  async register(rawName: unknown, ip: string, now: number): Promise<RegisterResponse> {
    const name = normalizeName(rawName)
    if (!name) throw new HubError(400, 'Pick a nickname')
    this.limit(this.registrations, ip, REGISTER_LIMIT, now, 'Too many new profiles from this network, try later')
    let code = generateCode()
    while (this.repo.userByCode(code)) code = generateCode()
    const token = newToken()
    const user: UserRow = { id: crypto.randomUUID(), code, name, tokenHash: await hashToken(token) }
    this.repo.createUser(user)
    return { userId: user.id, name, code, token, username: null }
  }

  /** Sliding-window rate limit keyed by network (and username for logins). */
  private limit(map: Map<string, number[]>, key: string, rule: { count: number; windowMs: number }, now: number, message: string) {
    const recent = (map.get(key) ?? []).filter((t) => now - t < rule.windowMs)
    if (recent.length >= rule.count) throw new HubError(429, message)
    map.set(key, [...recent, now])
    // Forget idle networks so the map can't grow without bound
    if (map.size > 10_000) map.clear()
  }

  private async userOfToken(token: string | null): Promise<UserRow> {
    const user = token ? this.repo.userByTokenHash(await hashToken(token)) : null
    if (!user) throw new HubError(401, 'Unknown profile')
    return user
  }

  /**
   * Attach a username and password. With the token of an existing profile, that profile
   * (its friends and code) becomes the account; otherwise a new profile is made.
   */
  async signup(body: unknown, token: string | null, ip: string, now: number): Promise<RegisterResponse> {
    const username = normalizeUsername(field(body, 'username'))
    if (!username) throw new HubError(400, 'Usernames are 3–20 letters, numbers, dots, dashes or underscores')
    const password = field(body, 'password')
    if (!validPassword(password)) throw new HubError(400, `Passwords need ${LIMITS.minPassword}–${LIMITS.maxPassword} characters`)
    const taken = () => new HubError(409, 'That username is taken')
    if (this.repo.accountByUsername(username)) throw taken()
    const existing = token ? await this.userOfToken(token) : null
    if (existing && this.repo.accountOf(existing.id)) throw new HubError(409, 'This profile already has an account')
    const name = existing ? existing.name : normalizeName(field(body, 'name'))
    if (!name) throw new HubError(400, 'Pick a nickname')
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const passHash = await hashPassword(password, salt, PBKDF2_ITERATIONS)
    // Someone may have taken the name while we were hashing
    if (this.repo.accountByUsername(username)) throw taken()

    const created = existing ? null : await this.register(name, ip, now)
    const user = existing ?? this.repo.userById(created!.userId)!
    this.repo.createAccount({ userId: user.id, username, passHash, salt: base64url(salt), iterations: PBKDF2_ITERATIONS, data: null, rev: 0 })
    return { ...this.selfInfo(user), token: created?.token ?? token! }
  }

  /** Sign in on a device: a new token for it, and the account's synced data. */
  async login(body: unknown, ip: string, now: number): Promise<LoginResponse> {
    const username = normalizeUsername(field(body, 'username'))
    const password = field(body, 'password')
    this.limit(this.logins, `${ip}|${username ?? ''}`, LOGIN_LIMIT, now, 'Too many sign-in attempts, try again in a few minutes')
    const account = username ? this.repo.accountByUsername(username) : null
    const user = account && this.repo.userById(account.userId)
    // Hash even when there's no such account, so timing doesn't reveal which usernames exist
    const salt = account ? fromBase64url(account.salt) : new Uint8Array(16)
    const hash = await hashPassword(typeof password === 'string' ? password : '', salt, account?.iterations ?? PBKDF2_ITERATIONS)
    if (!account || !user || !validPassword(password) || !sameString(hash, account.passHash)) throw new HubError(401, BAD_LOGIN)
    const token = newToken()
    this.repo.addToken(user.id, await hashToken(token))
    return { ...this.selfInfo(user), token, data: parseData(account.data), rev: account.rev }
  }

  /** Forget one device's sign-in. */
  async logout(token: string | null) {
    if (token) this.repo.deleteToken(await hashToken(token))
  }

  async getData(token: string | null): Promise<{ data: unknown; rev: number }> {
    const account = this.repo.accountOf((await this.userOfToken(token)).id)
    if (!account) throw new HubError(404, 'No account for this profile')
    return { data: parseData(account.data), rev: account.rev }
  }

  /** Save synced data if the client saw the latest revision; otherwise hand back the newer copy to merge. */
  async putData(body: unknown, token: string | null): Promise<{ rev: number }> {
    const user = await this.userOfToken(token)
    const account = this.repo.accountOf(user.id)
    if (!account) throw new HubError(404, 'No account for this profile')
    const data = field(body, 'data')
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new HubError(400, 'Bad data')
    const json = JSON.stringify(data)
    if (json.length > LIMITS.accountDataBytes) throw new HubError(413, 'Too much data')
    if (field(body, 'rev') !== account.rev) throw new HubError(409, 'Changed on another device', { data: parseData(account.data), rev: account.rev })
    const rev = account.rev + 1
    this.repo.saveData(user.id, json, rev)
    return { rev }
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
    return { userId: user.id, name: user.name, code: user.code, username: this.repo.accountOf(user.id)?.username ?? null }
  }

  private friendInfo(userId: string, now: number, exclude?: S): FriendInfo | null {
    const user = this.repo.userById(userId)
    if (!user) return null
    const visible = this.socketsOf(userId, exclude)
      .map((ws) => this.sessions.get(ws)!)
      .filter((s) => !s.invisible)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const online = visible.length > 0
    // Usernames are sign-in names, so friends never see them
    return { ...this.selfInfo(user), username: null, online, presence: online ? wirePresence(visible[0].presence, now) : null }
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
