import { LIMITS } from '../../src/social/protocol'
import type { Env } from './hub'

export { PresenceHub } from './hub'

const allowedOrigin = (env: Env, origin: string | null) => {
  if (!origin) return null
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  return allowed.includes('*') || allowed.includes(origin) ? origin : null
}

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

    if (url.pathname === '/api/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
      // Browsers always send Origin on WebSocket handshakes; refuse other sites' pages
      if (!origin) return new Response('Origin not allowed', { status: 403 })
      return hub().fetch('https://hub/ws', { headers: request.headers })
    }

    return new Response('Not found', { status: 404, headers: cors(origin) })
  },
} satisfies ExportedHandler<Env>
