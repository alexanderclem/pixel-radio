import { DurableObject } from 'cloudflare:workers'
import { Hub, HubError, newSession, type Repo, type Session, type Sessions, type UserRow } from './core'

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
