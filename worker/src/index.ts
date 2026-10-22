import { LIMITS } from '../../src/social/protocol'
import type { Env } from './hub'
import { nowPlaying, streamUrl } from './nowplaying'

export { PresenceHub } from './hub'

const allowedOrigin = (env: Env, origin: string | null) => {
  if (!origin) return null
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  return allowed.includes('*') || allowed.includes(origin) ? origin : null
}

/** Per-isolate request budget for title lookups, by client IP. */
const lookups = new Map<string, number[]>()
const LOOKUP_LIMIT = { count: 60, windowMs: 60_000 }

const cors = (origin: string | null): Record<string, string> =>
  origin
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {}

/** Edge entry: CORS/origin checks, then everything goes to the one presence room. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = allowedOrigin(env, request.headers.get('Origin'))
    const hub = () => env.HUB.get(env.HUB.idFromName('global'))

    if (request.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) })
    if (url.pathname === '/api/health') return new Response('ok', { headers: cors(origin) })

    if (url.pathname === '/api/register' && request.method === 'POST') {
      if (!origin) return new Response('Origin not allowed', { status: 403 })
      const body = await request.text()
      if (body.length > LIMITS.frameBytes) return new Response('Too large', { status: 413, headers: cors(origin) })
      const response = await hub().fetch('https://hub/register', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-client-ip': request.headers.get('CF-Connecting-IP') ?? 'unknown' },
      })
      const headers = new Headers(response.headers)
      for (const [k, v] of Object.entries(cors(origin))) headers.set(k, v)
      return new Response(response.body, { status: response.status, headers })
    }

    if (url.pathname === '/api/nowplaying' && request.method === 'GET') {
      if (!origin) return new Response('Origin not allowed', { status: 403 })
      const stream = streamUrl(url.searchParams.get('url'))
      if (!stream) return Response.json({ error: 'Bad stream address' }, { status: 400, headers: cors(origin) })
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
      const now = Date.now()
      const recent = (lookups.get(ip) ?? []).filter((t) => now - t < LOOKUP_LIMIT.windowMs)
      if (recent.length >= LOOKUP_LIMIT.count) return Response.json({ error: 'Slow down' }, { status: 429, headers: cors(origin) })
      if (lookups.size > 10_000) lookups.clear()
      lookups.set(ip, [...recent, now])
      const title = await nowPlaying(stream, now)
      return Response.json({ title }, { headers: { ...cors(origin), 'Cache-Control': 'private, max-age=10' } })
    }

    if (url.pathname === '/api/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
      // Browsers always send Origin on WebSocket handshakes; refuse other sites' pages
      if (!origin) return new Response('Origin not allowed', { status: 403 })
      return hub().fetch('https://hub/ws', { headers: request.headers })
    }

    return new Response('Not found', { status: 404, headers: cors(origin) })
  },
} satisfies ExportedHandler<Env>
