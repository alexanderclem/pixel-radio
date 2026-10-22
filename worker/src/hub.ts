import { DurableObject } from 'cloudflare:workers'
import { Hub, HubError, newSession, upgradeSession, type Repo, type RoomRow, type Session, type Sessions, type UserRow, type WorldState } from './core'

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
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS world (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL
);
`

type Row = { id: string; code: string; name: string; token_hash: string }
const toUser = (r: Row | undefined): UserRow | null => (r ? { id: r.id, code: r.code, name: r.name, tokenHash: r.token_hash } : null)

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
    return this.user('token_hash', hash)
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
  loadWorld() {
    const row = this.sql.exec<{ state: string }>('SELECT state FROM world WHERE id = 1').toArray()[0]
    try {
      return row ? (JSON.parse(row.state) as WorldState) : null
    } catch {
      return null
    }
  }
  saveWorld(world: WorldState) {
    this.sql.exec('INSERT OR REPLACE INTO world (id, state) VALUES (1, ?)', JSON.stringify(world))
  }
  private parseRoom(state: string | undefined) {
    try {
      return state ? (JSON.parse(state) as RoomRow) : null
    } catch {
      return null
    }
  }
  loadRoom(code: string) {
    return this.parseRoom(this.sql.exec<{ state: string }>('SELECT state FROM rooms WHERE code = ?', code).toArray()[0]?.state)
  }
  saveRoom(room: RoomRow) {
    this.sql.exec('INSERT OR REPLACE INTO rooms (code, state) VALUES (?, ?)', room.code, JSON.stringify(room))
  }
  deleteRoom(code: string) {
    this.sql.exec('DELETE FROM rooms WHERE code = ?', code)
  }
  allRooms() {
    return this.sql.exec<{ state: string }>('SELECT state FROM rooms').toArray().flatMap((r) => this.parseRoom(r.state) ?? [])
  }
}

/** Sessions ride on WebSocket attachments, so they survive the object hibernating. */
class SocketSessions implements Sessions<WebSocket> {
  private ctx: DurableObjectState
  constructor(ctx: DurableObjectState) {
    this.ctx = ctx
  }
  get(ws: WebSocket) {
    const raw = (ws.deserializeAttachment() as Partial<Session> | null) ?? null
    const session = upgradeSession(raw)
    // Sessions from before an upgrade get their new fields once, then keep them
    if (session && session !== raw) this.set(ws, session)
    return session
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

/** The single presence room: every client connects here, hears about its friends, and sees the public world. */
export class PresenceHub extends DurableObject<Env> {
  private hub: Hub<WebSocket>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(SCHEMA)
    // World updates go out on an alarm, so a burst of changes becomes one message
    const schedule = (at: number) => {
      void ctx.storage.getAlarm().then((current) => {
        if (current === null || current > at) return ctx.storage.setAlarm(at)
      })
    }
    this.hub = new Hub(new SqlRepo(ctx.storage.sql), new SocketSessions(ctx), schedule)
    // Heartbeats are answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/register' && request.method === 'POST') {
      try {
        const body = (await request.json().catch(() => null)) as { name?: unknown } | null
        const ip = request.headers.get('x-client-ip') ?? 'unknown'
        return Response.json(await this.hub.register(body?.name, ip, Date.now()))
      } catch (err) {
        if (err instanceof HubError) return Response.json({ error: err.message }, { status: err.status })
        throw err
      }
    }
    if (url.pathname === '/ws') {
      const { 0: client, 1: server } = new WebSocketPair()
      this.ctx.acceptWebSocket(server)
      server.serializeAttachment(newSession(Date.now(), request.headers.get('CF-Connecting-IP') ?? 'unknown'))
      return new Response(null, { status: 101, webSocket: client })
    }
    return new Response('Not found', { status: 404 })
  }

  async alarm() {
    this.hub.tick(Date.now())
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
