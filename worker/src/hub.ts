import { DurableObject } from 'cloudflare:workers'
import { Hub, HubError, newSession, type AccountRow, type Repo, type Session, type Sessions, type UserRow } from './core'

export interface Env {
  HUB: DurableObjectNamespace<PresenceHub>
  /** Comma-separated origins allowed to call the API, or "*" */
  ALLOWED_ORIGINS: string
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friends (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS accounts (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  data TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_user ON tokens (user_id);
`

type Row = { id: string; code: string; name: string; token_hash: string }
const toUser = (r: Row | undefined): UserRow | null => (r ? { id: r.id, code: r.code, name: r.name, tokenHash: r.token_hash } : null)

type AccountSqlRow = { user_id: string; username: string; pass_hash: string; salt: string; iterations: number; data: string | null; rev: number }
const toAccount = (r: AccountSqlRow | undefined): AccountRow | null =>
  r ? { userId: r.user_id, username: r.username, passHash: r.pass_hash, salt: r.salt, iterations: r.iterations, data: r.data, rev: r.rev } : null

/** Friendships are stored once per direction so lookups are a single index scan. */
class SqlRepo implements Repo {
  private sql: SqlStorage
  constructor(sql: SqlStorage) {
    this.sql = sql
  }
  private user(where: string, value: string) {
    return toUser(this.sql.exec<Row>(`SELECT id, code, name, token_hash FROM users WHERE ${where} = ?`, value).toArray()[0])
  }
  createUser(u: UserRow) {
    this.sql.exec('INSERT INTO users (id, code, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)', u.id, u.code, u.name, u.tokenHash, Date.now())
  }
  userById(id: string) {
    return this.user('id', id)
  }
  userByCode(code: string) {
    return this.user('code', code)
  }
  userByTokenHash(hash: string) {
    const device = this.sql.exec<{ user_id: string }>('SELECT user_id FROM tokens WHERE hash = ?', hash).toArray()[0]
    return device ? this.userById(device.user_id) : this.user('token_hash', hash)
  }
  addToken(userId: string, hash: string) {
    this.sql.exec('INSERT INTO tokens (hash, user_id, created_at) VALUES (?, ?, ?)', hash, userId, Date.now())
  }
  deleteToken(hash: string) {
    this.sql.exec('DELETE FROM tokens WHERE hash = ?', hash)
  }
  private account(where: string, value: string) {
    return toAccount(
      this.sql.exec<AccountSqlRow>(`SELECT user_id, username, pass_hash, salt, iterations, data, rev FROM accounts WHERE ${where} = ?`, value).toArray()[0],
    )
  }
  createAccount(a: AccountRow) {
    this.sql.exec(
      'INSERT INTO accounts (user_id, username, pass_hash, salt, iterations, data, rev, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      a.userId, a.username, a.passHash, a.salt, a.iterations, a.data, a.rev, Date.now(),
    )
  }
  accountOf(userId: string) {
    return this.account('user_id', userId)
  }
  accountByUsername(username: string) {
    return this.account('username', username)
  }
  saveData(userId: string, data: string, rev: number) {
    this.sql.exec('UPDATE accounts SET data = ?, rev = ?, updated_at = ? WHERE user_id = ?', data, rev, Date.now(), userId)
  }
  rename(id: string, name: string) {
    this.sql.exec('UPDATE users SET name = ? WHERE id = ?', name, id)
  }
  friendsOf(id: string) {
    return this.sql.exec<{ b: string }>('SELECT b FROM friends WHERE a = ?', id).toArray().map((r) => r.b)
  }
  addFriendship(a: string, b: string) {
    this.sql.exec('INSERT OR IGNORE INTO friends (a, b) VALUES (?, ?), (?, ?)', a, b, b, a)
  }
  removeFriendship(a: string, b: string) {
    this.sql.exec('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', a, b, b, a)
  }
}

/** Sessions ride on WebSocket attachments, so they survive the object hibernating. */
class SocketSessions implements Sessions<WebSocket> {
  private ctx: DurableObjectState
  constructor(ctx: DurableObjectState) {
    this.ctx = ctx
  }
  get(ws: WebSocket) {
    return (ws.deserializeAttachment() as Session | null) ?? null
  }
  set(ws: WebSocket, session: Session) {
    try {
      ws.serializeAttachment(session)
    } catch {
      // Socket already closed
    }
  }
  all() {
    return this.ctx.getWebSockets()
  }
}

/** The single presence room: every client connects here and only hears about its friends. */
export class PresenceHub extends DurableObject<Env> {
  private hub: Hub<WebSocket>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(SCHEMA)
    this.hub = new Hub(new SqlRepo(ctx.storage.sql), new SocketSessions(ctx))
    // Heartbeats are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const ip = request.headers.get('x-client-ip') ?? 'unknown'
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{20,128})$/)?.[1] ?? null
    const body = () => request.json().catch(() => null)
    const run = async (work: () => Promise<unknown>) => {
      try {
        return Response.json(await work(), { headers: { 'Cache-Control': 'no-store' } })
      } catch (err) {
        if (err instanceof HubError) return Response.json({ ...err.body, error: err.message }, { status: err.status })
        throw err
      }
    }
    const post = request.method === 'POST'
    if (url.pathname === '/register' && post) return run(async () => this.hub.register(((await body()) as { name?: unknown } | null)?.name, ip, Date.now()))
    if (url.pathname === '/account/signup' && post) return run(async () => this.hub.signup(await body(), token, ip, Date.now()))
    if (url.pathname === '/account/login' && post) return run(async () => this.hub.login(await body(), ip, Date.now()))
    if (url.pathname === '/account/logout' && post) return run(async () => (await this.hub.logout(token), { ok: true }))
    if (url.pathname === '/account/data' && request.method === 'GET') return run(() => this.hub.getData(token))
    if (url.pathname === '/account/data' && request.method === 'PUT') return run(async () => this.hub.putData(await body(), token))
    if (url.pathname === '/ws') {
      const { 0: client, 1: server } = new WebSocketPair()
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment(newSession(Date.now()))
      return new Response(null, { status: 101, webSocket: client })
    }
    return new Response('Not found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.hub.message(ws, typeof message === 'string' ? message : null, Date.now())
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.hub.close(ws, Date.now())
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye')
    } catch {
      // Already closed
    }
  }

  async webSocketError(ws: WebSocket) {
    this.hub.close(ws, Date.now())
  }
}
