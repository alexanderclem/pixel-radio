import { icyTitleFromBytes } from '../../src/nowplaying/parse'

/** Largest ICY interval we'll read through; real servers use 8–64 KiB. */
const MAX_METAINT = 128 * 1024
const TIMEOUT_MS = 6000
const CACHE_MS = 15_000

const cache = new Map<string, { title: string | null; at: number }>()

/** Only plain http(s) stream addresses on public hostnames. */
export function streamUrl(raw: string | null): URL | null {
  if (!raw || raw.length > 2048) return null
  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null
    // IP literals in private/loopback/link-local ranges
    if (/^(10|127)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\.|^0\.|^\[/.test(host)) return null
    return url
  } catch {
    return null
  }
}

/**
 * Ask the stream for ICY metadata and read up to the first metadata block, then hang
 * up. Costs one interval of audio (typically 16 KiB) per lookup.
 */
export async function readIcyTitle(url: URL, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const res = await fetchImpl(url.toString(), {
    headers: { 'Icy-MetaData': '1', 'User-Agent': 'PixelRadio/1.0 (now playing)' },
    signal,
  })
  const metaint = Number(res.headers.get('icy-metaint'))
  if (!res.ok || !res.body || !Number.isInteger(metaint) || metaint <= 0 || metaint > MAX_METAINT) {
    await res.body?.cancel().catch(() => {})
    return null
  }
  const reader = res.body.getReader()
  let buffer = new Uint8Array(0)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return null
      const next = new Uint8Array(buffer.length + value.length)
      next.set(buffer)
      next.set(value, buffer.length)
      buffer = next
      const title = icyTitleFromBytes(buffer, metaint)
      if (title !== undefined) return title
      // A metadata block is at most 255 × 16 bytes
      if (buffer.length > metaint + 1 + 255 * 16) return null
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Cached per stream for a few seconds so many listeners cost one lookup. */
export async function nowPlaying(url: URL, now: number, fetchImpl?: typeof fetch): Promise<string | null> {
  const key = url.toString()
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_MS) return hit.title
  let title: string | null = null
  try {
    title = await readIcyTitle(url, fetchImpl)
  } catch {
    // Unreachable or not an ICY stream: report no title
  }
  if (cache.size > 500) cache.clear()
  cache.set(key, { title, at: now })
  return title
}
