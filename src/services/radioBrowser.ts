import type { CityPreset, Station } from '../types'

const BOOTSTRAP = ['https://de1.api.radio-browser.info', 'https://all.api.radio-browser.info']
let mirrors = [...BOOTSTRAP]
let healthyMirror = BOOTSTRAP[0]
let discovery: Promise<void> | null = null
let refreshAfter = 0

/** Discover current servers without delaying the first catalogue request. */
function discoverServers() {
  if (discovery || Date.now() < refreshAfter) return
  refreshAfter = Date.now() + 60000
  discovery = (async () => {
    for (const origin of [...new Set([healthyMirror, ...BOOTSTRAP])]) {
      try {
        const response = await fetch(`${origin}/json/servers`, { signal: AbortSignal.timeout(2500) })
        if (!response.ok) continue
        const servers: unknown = await response.json()
        if (!Array.isArray(servers)) continue
        const names = servers.flatMap((server: { name?: unknown } | null) =>
          typeof server?.name === 'string' && /^[a-z0-9-]+\.api\.radio-browser\.info$/i.test(server.name)
            ? [`https://${server.name.toLowerCase()}`] : [],
        )
        if (names.length) {
          mirrors = [...new Set([...names, ...BOOTSTRAP])]
          refreshAfter = Date.now() + 5 * 60000
          return
        }
      } catch {
        // Discovery is optional; known bootstrap hosts remain usable.
      }
    }
  })().finally(() => { discovery = null })
}

/** Subset of the Radio Browser station schema we use. */
interface RBStation {
  stationuuid: string
  name: string
  url_resolved: string
  codec: string
  bitrate: number
  hls: number
  lastcheckok: number
  countrycode: string
  country: string
  state: string
  homepage: string
  tags: string
  clickcount: number
  geo_lat: number | null
  geo_long: number | null
}

const cityCache = new Map<string, { stations: Station[]; expires: number }>()

async function apiGet<T>(path: string, params: Record<string, string | number | boolean>, signal?: AbortSignal): Promise<T> {
  const deadline = AbortSignal.timeout(8000)
  const overall = signal ? AbortSignal.any([signal, deadline]) : deadline
  overall.throwIfAborted()
  discoverServers()
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const tried = new Set<string>()
  let lastError: unknown
  for (;;) {
    overall.throwIfAborted()
    const origin = [healthyMirror, ...mirrors].find((host) => !tried.has(host))
    if (!origin) break
    tried.add(origin)
    try {
      const res = await fetch(`${origin}${path}?${query}`, {
        signal: AbortSignal.any([overall, AbortSignal.timeout(3000)]),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: unknown = await res.json()
      overall.throwIfAborted()
      if (!Array.isArray(data)) throw new Error('Invalid station catalogue')
      healthyMirror = origin
      return data as T
    } catch (err) {
      if (overall.aborted) throw overall.reason
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Radio Browser unreachable')
}

const PLAYLIST_EXT = /\.(m3u|pls|asx|xspf)(\?|$)/i

function toStation(rb: RBStation): Station | null {
  if (!rb || typeof rb.stationuuid !== 'string' || typeof rb.name !== 'string') return null
  const url = typeof rb.url_resolved === 'string' ? rb.url_resolved.trim() : ''
  if (!/^https?:\/\//i.test(url) || rb.lastcheckok !== 1) return null
  // Pages served over HTTPS cannot load http:// media (mixed content)
  if (location.protocol === 'https:' && !/^https:\/\//i.test(url)) return null
  const hls = rb.hls === 1 || /\.m3u8(\?|$)/i.test(url)
  if (!hls && PLAYLIST_EXT.test(url)) return null
  const hasGeo = typeof rb.geo_lat === 'number' && Number.isFinite(rb.geo_lat) && Math.abs(rb.geo_lat) <= 90 &&
    typeof rb.geo_long === 'number' && Number.isFinite(rb.geo_long) && Math.abs(rb.geo_long) <= 180 && (rb.geo_lat !== 0 || rb.geo_long !== 0)
  const state = typeof rb.state === 'string' ? rb.state.trim() : ''
  const country = typeof rb.country === 'string' ? rb.country.trim() : ''
  return {
    id: rb.stationuuid,
    name: rb.name.trim().replace(/\s+/g, ' ') || 'Unknown station',
    url,
    hls,
    codec: rb.codec || '???',
    bitrate: rb.bitrate || 0,
    country: rb.countrycode || '',
    state,
    location: [state, country].filter(Boolean).join(', ') || 'Unknown location',
    homepage: rb.homepage,
    tags: rb.tags ?? '',
    popularity: rb.clickcount ?? 0,
    lat: hasGeo ? rb.geo_lat : null,
    lon: hasGeo ? rb.geo_long : null,
    approx: false,
    source: 'radio-browser',
  }
}

const convert = (list: RBStation[]) => list.map(toStation).filter((s): s is Station => s !== null)

const BASE_QUERY = { hidebroken: true, order: 'clickcount', reverse: true }

/** One page of the geolocated catalogue, most popular first. */
export async function fetchGeoStations(offset: number, limit: number): Promise<{ stations: Station[]; raw: number }> {
  const list = await apiGet<RBStation[]>('/json/stations/search', { ...BASE_QUERY, has_geo_info: true, offset, limit })
  return { stations: convert(list), raw: list.length }
}

export async function fetchStationsNear(lat: number, lon: number, radiusKm: number, limit: number): Promise<Station[]> {
  const list = await apiGet<RBStation[]>('/json/stations/search', {
    ...BASE_QUERY, geo_lat: lat.toFixed(3), geo_long: lon.toFixed(3), geo_distance: Math.round(radiusKm * 1000), limit,
  })
  return convert(list)
}

/** Stations in a country that carry no coordinates (placed approximately by the index). */
export async function fetchUnplacedStations(countryCode: string, limit: number): Promise<Station[]> {
  const list = await apiGet<RBStation[]>('/json/stations/search', {
    ...BASE_QUERY, countrycode: countryCode, has_geo_info: false, limit,
  })
  return convert(list)
}

export async function searchStations(query: string, signal?: AbortSignal, limit = 40, countryCode?: string): Promise<Station[]> {
  const list = await apiGet<RBStation[]>(
    '/json/stations/search',
    { ...BASE_QUERY, name: query, limit, ...(countryCode ? { countrycode: countryCode } : {}) },
    signal,
  )
  return convert(list)
}

/** Most popular working stations with a tag, e.g. "jazz". */
export async function searchByTag(tag: string, signal?: AbortSignal, limit = 20): Promise<Station[]> {
  const list = await apiGet<RBStation[]>('/json/stations/search', { ...BASE_QUERY, tag, tagExact: false, limit }, signal)
  return convert(list)
}

/** One station by Radio Browser UUID, e.g. to tune in to what a friend is playing. */
export async function fetchStationById(id: string, signal?: AbortSignal): Promise<Station | null> {
  const list = await apiGet<RBStation[]>('/json/stations/byuuid', { uuids: id }, signal)
  return convert(list).find((s) => s.id === id) ?? null
}

/**
 * Stations geographically near the city first (radius search), topped up with the
 * most popular stations in the same country. HTTPS streams are ranked ahead of HTTP.
 */
export async function findStationsForCity(city: CityPreset, signal?: AbortSignal, limit = 10): Promise<Station[]> {
  const cached = cityCache.get(city.id)
  signal?.throwIfAborted()
  if (cached && cached.expires > Date.now()) return cached.stations.slice(0, limit)
  const deadline = AbortSignal.timeout(4500)
  const lookupSignal = signal ? AbortSignal.any([signal, deadline]) : deadline

  const [nearby, national] = await Promise.allSettled([
    apiGet<RBStation[]>('/json/stations/search', {
      ...BASE_QUERY, geo_lat: city.lat, geo_long: city.lon, geo_distance: 120000, limit: 30,
    }, lookupSignal),
    apiGet<RBStation[]>('/json/stations/search', { ...BASE_QUERY, countrycode: city.countryCode, limit: 30 }, lookupSignal),
  ])
  signal?.throwIfAborted()
  if (nearby.status === 'rejected' && national.status === 'rejected') throw nearby.reason

  const raw = [
    ...(nearby.status === 'fulfilled' ? nearby.value : []),
    ...(national.status === 'fulfilled' ? national.value : []),
  ]
  const seen = new Set<string>()
  const stations: Station[] = []
  for (const s of convert(raw)) {
    const key = s.url.toLowerCase()
    const nameKey = s.name.toLowerCase()
    if (seen.has(key) || seen.has(nameKey)) continue
    seen.add(key)
    seen.add(nameKey)
    stations.push(s)
  }
  // Stable sort: HTTPS first keeps original popularity order within each group
  stations.sort((a, b) => Number(b.url.startsWith('https://')) - Number(a.url.startsWith('https://')))

  const result = stations.slice(0, limit)
  if (result.length) cityCache.set(city.id, { stations, expires: Date.now() + 5 * 60000 })
  return result
}

/** Tell Radio Browser a station was played (their click counter). Fire and forget. */
export function reportClick(station: Station) {
  if (station.source !== 'radio-browser') return
  fetch(`${healthyMirror}/json/url/${encodeURIComponent(station.id)}`, { signal: AbortSignal.timeout(3000) }).catch(() => {})
}
