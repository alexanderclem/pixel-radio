import { streamUrl } from './nowplaying'

/**
 * Plain-http station streams relayed over the site's HTTPS origin, so pages served over
 * HTTPS can play them. Callers name a Radio Browser station, never a URL: the Worker
 * looks the address up itself, so it can't be used as a general-purpose proxy.
 */

const CATALOGUE = 'https://all.api.radio-browser.info'
const LOOKUP_TIMEOUT_MS = 4000
const CONNECT_TIMEOUT_MS = 8000
const CACHE_MS = 60 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Audio (and the containers stations actually use); anything else is refused. */
const AUDIO_TYPE = /^(audio\/|application\/(ogg|octet-stream)|video\/mp2t)/i

const addresses = new Map<string, { url: URL | null; at: number }>()

/** STREAM_RELAY is the on/off switch; anything but "on" disables the relay. */
export const relayEnabled = (flag: string | undefined) => flag?.trim().toLowerCase() === 'on'

export const isStationId = (id: string) => UUID.test(id)

/** The station's stream address, if it is one the relay serves: public, plain http, not a playlist. */
export async function stationAddress(id: string, now: number, fetchImpl: typeof fetch = fetch): Promise<URL | null> {
  const cached = addresses.get(id)
  if (cached && now - cached.at < CACHE_MS) return cached.url
  const res = await fetchImpl(`${CATALOGUE}/json/stations/byuuid?uuids=${encodeURIComponent(id)}`, {
    headers: { 'User-Agent': 'PixelRadio/1.0 (relay)' },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Catalogue answered ${res.status}`)
  const list: unknown = await res.json()
  const station = Array.isArray(list) ? (list as { stationuuid?: unknown; url_resolved?: unknown; hls?: unknown }[]).find((s) => s?.stationuuid === id) : undefined
  const raw = typeof station?.url_resolved === 'string' ? station.url_resolved.trim() : null
  const url = streamUrl(raw)
  const usable = url && url.protocol === 'http:' && station?.hls !== 1 && !/\.(m3u8?|pls|asx|xspf)$/i.test(url.pathname) ? url : null
  if (addresses.size > 5000) addresses.clear()
  addresses.set(id, { url: usable, at: now })
  return usable
}

/**
 * Connect to the stream and pass its body straight through. The Worker doesn't touch the
 * bytes, so a long listen costs no CPU time; the upstream connection closes when the
 * listener's does.
 */
export async function relayStream(url: URL, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Response> {
  // The timeout covers connecting only; the signal stays attached to the body for the whole listen
  const connect = new AbortController()
  const timer = setTimeout(() => connect.abort(new DOMException('Station timed out', 'TimeoutError')), CONNECT_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(url.toString(), {
      // No Range or ICY metadata: live streams can't seek, and the player wants pure audio
      headers: { 'User-Agent': 'PixelRadio/1.0 (relay)', 'Icy-MetaData': '0' },
      signal: AbortSignal.any([signal, connect.signal]),
    })
  } finally {
    clearTimeout(timer)
  }
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !res.body || !AUDIO_TYPE.test(type)) {
    await res.body?.cancel().catch(() => {})
    return new Response('Station did not answer with audio', { status: 502 })
  }
  return new Response(res.body, {
    headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
