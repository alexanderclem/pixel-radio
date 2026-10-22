import { FALLBACK_STATIONS } from '../../src/constants/fallbackStreams'
import { isId } from '../../src/social/protocol'

/**
 * Link previews for shared stations (/s/<id>): the app's index.html with the title and
 * Open Graph tags naming the station, so chat apps show "KEXP · Seattle" instead of
 * a generic card. The app itself reads the path and tunes in.
 */

export interface StationLabel {
  name: string
  location: string
}

export interface PageMeta {
  title: string
  description: string
  url: string
  image: string
}

export function stationMeta(station: StationLabel | null, id: string, origin: string): PageMeta {
  const url = `${origin}/s/${encodeURIComponent(id)}`
  const image = `${origin}/og-image.png`
  if (!station) {
    return { title: 'Pixel Radio', description: 'Live radio from real places, with your friends in it.', url, image }
  }
  const where = station.location ? `live from ${station.location}` : 'live'
  return {
    title: `${station.name} · Pixel Radio`,
    description: `Listen to ${station.name}, ${where}, on a pixel planet of real radio stations.`,
    url,
    image,
  }
}

const cache = new Map<string, { label: StationLabel | null; expires: number }>()
const DAY_MS = 24 * 60 * 60_000

/** Station name and place by Radio Browser UUID (curated ids are known locally); null if unknown. */
export async function lookupStation(id: string, now: number, fetchImpl: typeof fetch = fetch): Promise<StationLabel | null> {
  const curated = FALLBACK_STATIONS.find((s) => s.id === id)
  if (curated) return { name: curated.name, location: curated.location }
  const hit = cache.get(id)
  if (hit && hit.expires > now) return hit.label
  let label: StationLabel | null = null
  try {
    const res = await fetchImpl(`https://all.api.radio-browser.info/json/stations/byuuid?uuids=${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': 'PixelRadio/1.0 (+https://pixelradios.com)' },
      signal: AbortSignal.timeout(2500),
    })
    if (res.ok) {
      const list = (await res.json()) as { stationuuid?: unknown; name?: unknown; state?: unknown; country?: unknown }[]
      const row = Array.isArray(list) ? list.find((s) => s?.stationuuid === id) : undefined
      const name = typeof row?.name === 'string' ? row.name.trim().slice(0, 80) : ''
      if (name) {
        const place = [row?.state, row?.country].filter((v): v is string => typeof v === 'string' && v.trim() !== '').join(', ')
        label = { name, location: place.slice(0, 80) }
      }
    }
  } catch {
    // Directory slow or down: a generic preview is fine, and we try again next time
    return null
  }
  if (cache.size > 1000) cache.clear()
  cache.set(id, { label, expires: now + DAY_MS })
  return label
}

export async function stationPage(request: Request, assets: Fetcher, now = Date.now()): Promise<Response> {
  const url = new URL(request.url)
  const index = await assets.fetch(new Request(new URL('/', url), request))
  let id = ''
  try {
    id = decodeURIComponent(url.pathname.slice(3).replace(/\/$/, ''))
  } catch {
    return index
  }
  if (!isId(id) || !index.headers.get('content-type')?.includes('text/html')) return index
  const meta = stationMeta(await lookupStation(id, now), id, url.origin)
  const set = (content: string) => ({ element: (el: Element) => void el.setAttribute('content', content) })
  return new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(meta.title) })
    .on('meta[name="description"]', set(meta.description))
    .on('meta[property="og:title"]', set(meta.title))
    .on('meta[property="og:description"]', set(meta.description))
    .on('meta[property="og:url"]', set(meta.url))
    .on('meta[property="og:image"]', set(meta.image))
    .transform(index)
}
