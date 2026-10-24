import { mapView } from '../render/mapSnapshot'
import { findStations, searchByTag, type StationQuery } from '../services/radioBrowser'
import { stationIndex } from '../services/stationIndex'
import { useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { qualityScore } from './quality'
import { tagList } from './talk'
import { parseVibe, type ParsedVibe } from './vibes'

type TagSearch = (tag: string, signal?: AbortSignal, limit?: number) => Promise<Station[]>
type Find = (q: StationQuery, signal?: AbortSignal) => Promise<Station[]>

/** Tags looked up per vibe group; the rest still count when ranking. */
const TAGS_PER_GROUP = 3

/** Whether a station's tags include one of these (substring, so "smooth jazz" has "jazz"). */
const hasAny = (tags: string[], wanted: string[]) => wanted.some((w) => tags.some((t) => t.includes(w)))

/** Results the "Music only" switch allows. */
const kept = (list: Station[]) => list.filter((s) => stationIndex.keeps(s))

/** One entry per station id, first one wins. */
const unique = (list: Station[]) => {
  const seen = new Set<string>()
  return list.filter((s) => !seen.has(s.id) && seen.add(s.id))
}

/**
 * Stations for a vibe, best first: ones matching every part of it ("upbeat" and
 * "cyberpunk") ahead of ones matching some, then by popularity, sound and reliability.
 */
export async function vibeSearch(
  query: string | ParsedVibe,
  { signal, limit = 40, searchTag = searchByTag }: { signal?: AbortSignal; limit?: number; searchTag?: TagSearch } = {},
): Promise<Station[]> {
  const vibe = typeof query === 'string' ? parseVibe(query) : query
  if (!vibe.groups.length) return []
  const tags = [...new Set(vibe.groups.flatMap((g) => g.tags.slice(0, TAGS_PER_GROUP)))]
  const found = await Promise.allSettled(tags.map((tag) => searchTag(tag, signal, 30)))
  signal?.throwIfAborted()
  if (found.every((r) => r.status === 'rejected')) throw (found[0] as PromiseRejectedResult).reason
  const stations = kept(unique(found.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))))
  return stations
    .map((s) => {
      const own = tagList(s.tags)
      const hits = vibe.groups.filter((g) => hasAny(own, g.tags)).length
      return { s, score: hits * 10 + qualityScore(s) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s)
}

/** Name, genre, language and country filters together. */
export async function filteredSearch(q: StationQuery, { signal, find = findStations }: { signal?: AbortSignal; find?: Find } = {}) {
  const list = await find({ limit: 60, ...q }, signal)
  return kept(list).sort((a, b) => qualityScore(b) - qualityScore(a)).slice(0, 40)
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  let both = 0
  for (const x of a) if (b.has(x)) both++
  return both / (a.size + b.size - both || 1)
}

/** Tags that describe the music rather than the place or the format. */
const GENERIC = new Set(['music', 'radio', 'fm', 'am', 'online', 'internet radio', 'hits', 'various', 'variety', 'local', 'community radio', 'public radio'])

/**
 * Stations like this one: sharing its genre tags, then its language, then nearby on the
 * map when it has no useful tags.
 */
export async function similarTo(
  station: Station,
  { signal, limit = 12, searchTag = searchByTag }: { signal?: AbortSignal; limit?: number; searchTag?: TagSearch } = {},
): Promise<Station[]> {
  const own = new Set(tagList(station.tags).filter((t) => !GENERIC.has(t) && t.length > 1))
  const languages = new Set((station.language ?? '').split(',').map((l) => l.trim()).filter(Boolean))
  let found: Station[] = []
  if (own.size) {
    const results = await Promise.allSettled([...own].slice(0, 3).map((tag) => searchTag(tag, signal, 40)))
    signal?.throwIfAborted()
    found = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  }
  const ranked = kept(unique(found))
    .filter((s) => s.id !== station.id && s.url !== station.url)
    .map((s) => {
      const theirs = new Set(tagList(s.tags))
      const sameLanguage = (s.language ?? '').split(',').some((l) => languages.has(l.trim()))
      return { s, score: jaccard(own, theirs) * 6 + (sameLanguage ? 1 : 0) + qualityScore(s) * 0.3 }
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s)
  if (ranked.length >= limit || station.lat === null || station.lon === null) return ranked.slice(0, limit)
  // Thin results: top up with the station's neighbours on the map
  const near = stationIndex.nearest(station.lon, station.lat, limit, station.id)
  return unique([...ranked, ...near]).slice(0, limit)
}

/** The country "near you" means: the playing station's, else the one the map is looking at. */
export function nearbyCountry(): string | null {
  const s = useRadioStore.getState()
  if (s.station?.country && s.station.source !== 'curated') return s.station.country
  const view = mapView()
  if (!view) return null
  const [near] = stationIndex.nearest(view.camera.lon, view.camera.lat, 1, undefined, { all: true })
  return near?.country || null
}

/** Stations whose plays are rising fastest, worldwide or in one country. */
export async function trending(countryCode: string | null, { signal, find = findStations }: { signal?: AbortSignal; find?: Find } = {}) {
  const list = await find({ order: 'clicktrend', limit: 40, ...(countryCode ? { countryCode } : {}) }, signal)
  return kept(list).slice(0, 15)
}

const recentSurprises: string[] = []

/**
 * A random station from the map, likelier the more people listen to it: never the one
 * that's on, nor one of the last few surprises. Within a vibe's results when given.
 */
export function surprise({ from, random = Math.random }: { from?: Station[]; random?: () => number } = {}): Station | null {
  const playing = useRadioStore.getState().station?.id
  const pool = (from?.length ? kept(from) : stationIndex.view().stations).filter(
    (s) => s.id !== playing && !recentSurprises.includes(s.id),
  )
  if (!pool.length) return null
  // Square root of plays: popular stations come up more, but the long tail still does
  const weights = pool.map((s) => Math.sqrt(Math.max(0, s.popularity)) + 1)
  let roll = random() * weights.reduce((a, b) => a + b, 0)
  let pick = pool[pool.length - 1]
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll < 0) {
      pick = pool[i]
      break
    }
  }
  recentSurprises.push(pick.id)
  if (recentSurprises.length > 20) recentSurprises.shift()
  return pick
}

/** Tune a station found by discovery and fly the map to it. */
export function playFound(station: Station) {
  stationIndex.add([station])
  // The index may have placed it approximately; tune the placed copy so the map can fly to it
  useRadioStore.getState().requestStation(stationIndex.get(station.id) ?? station, true)
}

/** Surprise me: tune a random station, or say why there's nothing to pick yet. */
export function playSurprise(from?: Station[]) {
  const s = useRadioStore.getState()
  const pick = surprise({ from })
  if (!pick) {
    s.showToast('No stations on the map yet. Give it a moment to load.')
    return
  }
  playFound(pick)
  s.showToast(`Surprise: ${pick.name} · ${pick.location}`)
}
