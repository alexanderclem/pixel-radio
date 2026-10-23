import { CITY_BY_ID } from '../constants/cities'
import { FALLBACK_STATIONS } from '../constants/fallbackStreams'
import { findStationsForCity, searchByTag } from '../services/radioBrowser'
import { stationIndex } from '../services/stationIndex'
import { useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { ATMOSPHERE_NAMES } from './atmosphereNames'
import type { SessionSettings, StationPick } from './setup'

/**
 * Themed atmospheres: a station picked live from the directory plus a mood (weather, sky,
 * ambience, optionally a timer). The mood is themed; the station's real location is
 * always shown alongside it.
 */

export type { StationPick }

export interface Atmosphere {
  id: string
  name: string
  /** One line for the chooser */
  tagline: string
  /** Where the music actually comes from, in plain words */
  source: string
  pick: StationPick
  /** Curated station used when the directory can't be reached */
  fallbackId: string
  settings: Omit<SessionSettings, 'atmosphereId' | 'moodName'>
  /** Made by the listener (editable), not built in */
  custom?: boolean
}

/** "A popular station near Tokyo" as it reads mid-sentence, keeping place names capitalised. */
export const musicFrom = (atm: Pick<Atmosphere, 'source'>) => atm.source.charAt(0).toLowerCase() + atm.source.slice(1)


export const ATMOSPHERES: Atmosphere[] = [
  {
    id: 'rainy-tokyo',
    name: ATMOSPHERE_NAMES['rainy-tokyo'],
    tagline: 'Night rain over the city, a Tokyo-area station on the dial.',
    source: 'A popular station near Tokyo',
    pick: { kind: 'city', cityId: 'tokyo' },
    fallbackId: 'rp-mellow',
    settings: {
      view: { lon: 139.69, lat: 35.68, zoom: 6 },
      weather: { mode: 'rain', density: 0.65, wind: 0.42 },
      sky: 'night',
      mix: { rain: 0.85, wind: 0.3, city: 0.55, fire: 0, pad: 0.45, staticBlend: 0.05, hiss: 0.1, cutoff: 0.85 },
      ambientLinked: false,
      timer: null,
    },
  },
  {
    id: 'morning-jazz',
    name: ATMOSPHERE_NAMES['morning-jazz'],
    tagline: 'Golden light, a crackling fire and a jazz station from wherever it plays.',
    source: 'The most popular jazz station that answers',
    pick: { kind: 'tag', tags: ['jazz', 'smooth jazz'] },
    fallbackId: 'rp-main',
    settings: {
      view: null,
      weather: { mode: 'clear', density: 0.3, wind: 0.5 },
      sky: 'golden',
      mix: { rain: 0, wind: 0.2, city: 0.25, fire: 0.3, pad: 0.3, staticBlend: 0.04, hiss: 0.08, cutoff: 0.95 },
      ambientLinked: false,
      timer: null,
    },
  },
  {
    id: 'quiet-study',
    name: ATMOSPHERE_NAMES['quiet-study'],
    tagline: 'Soft rain, a low fire, calm music and a 50-minute focus timer.',
    source: 'A lo-fi or ambient station',
    pick: { kind: 'tag', tags: ['lofi', 'lo-fi', 'ambient', 'chillout'] },
    fallbackId: 'rp-mellow',
    settings: {
      view: null,
      weather: { mode: 'rain', density: 0.35, wind: 0.45 },
      sky: 'night',
      mix: { rain: 0.45, wind: 0.15, city: 0.05, fire: 0.55, pad: 0.55, staticBlend: 0.03, hiss: 0.05, cutoff: 0.8 },
      ambientLinked: false,
      timer: { work: 50, short: 10 },
    },
  },
  {
    id: 'snowy-cabin',
    name: ATMOSPHERE_NAMES['snowy-cabin'],
    tagline: 'Snow against the window, a big fire and quiet folk on the radio.',
    source: 'A folk or acoustic station',
    pick: { kind: 'tag', tags: ['folk', 'acoustic', 'singer-songwriter'] },
    fallbackId: 'rp-mellow',
    settings: {
      view: null,
      weather: { mode: 'snow', density: 0.55, wind: 0.38 },
      sky: 'night',
      mix: { rain: 0, wind: 0.5, city: 0, fire: 0.75, pad: 0.35, staticBlend: 0.04, hiss: 0.08, cutoff: 0.82 },
      ambientLinked: false,
      timer: null,
    },
  },
  {
    id: 'thunderstorm',
    name: ATMOSPHERE_NAMES['thunderstorm'],
    tagline: 'A storm rolling over at night, with classical music to ride it out.',
    source: 'A classical station',
    pick: { kind: 'tag', tags: ['classical', 'piano'] },
    fallbackId: 'rp-mellow',
    settings: {
      view: null,
      weather: { mode: 'storm', density: 0.8, wind: 0.25 },
      sky: 'night',
      mix: { rain: 0.95, wind: 0.7, city: 0, fire: 0, pad: 0.2, staticBlend: 0.06, hiss: 0.1, cutoff: 0.78 },
      ambientLinked: false,
      timer: null,
    },
  },
  {
    id: 'northern-lights',
    name: ATMOSPHERE_NAMES['northern-lights'],
    tagline: 'Aurora over Iceland, light snow and a Reykjavik station.',
    source: 'A station near Reykjavik',
    pick: { kind: 'city', cityId: 'reykjavik' },
    fallbackId: 'rp-world',
    settings: {
      view: { lon: -21.94, lat: 64.15, zoom: 5 },
      weather: { mode: 'snow', density: 0.25, wind: 0.6 },
      sky: 'aurora',
      mix: { rain: 0, wind: 0.45, city: 0, fire: 0.15, pad: 0.7, staticBlend: 0.05, hiss: 0.08, cutoff: 0.9 },
      ambientLinked: false,
      timer: null,
    },
  },
  {
    id: 'paris-cafe',
    name: ATMOSPHERE_NAMES['paris-cafe'],
    tagline: 'A clear golden afternoon, street chatter and a Paris station.',
    source: 'A station near Paris',
    pick: { kind: 'city', cityId: 'paris' },
    fallbackId: 'rp-main',
    settings: {
      view: { lon: 2.35, lat: 48.86, zoom: 6 },
      weather: { mode: 'clear', density: 0.2, wind: 0.55 },
      sky: 'golden',
      mix: { rain: 0, wind: 0.1, city: 0.7, fire: 0, pad: 0.25, staticBlend: 0.03, hiss: 0.06, cutoff: 0.95 },
      ambientLinked: false,
      timer: null,
    },
  },
  {
    id: 'campfire',
    name: ATMOSPHERE_NAMES['campfire'],
    tagline: 'Embers drifting up into the night and Americana around the fire.',
    source: 'An Americana or folk station',
    pick: { kind: 'tag', tags: ['americana', 'bluegrass', 'folk'] },
    fallbackId: 'rp-main',
    settings: {
      view: null,
      weather: { mode: 'embers', density: 0.45, wind: 0.55 },
      sky: 'night',
      mix: { rain: 0, wind: 0.25, city: 0, fire: 0.9, pad: 0.2, staticBlend: 0.05, hiss: 0.1, cutoff: 0.88 },
      ambientLinked: false,
      timer: null,
    },
  },
  {
    id: 'seaside-bossa',
    name: ATMOSPHERE_NAMES['seaside-bossa'],
    tagline: 'A bright breezy day by the sea with bossa nova on the radio.',
    source: 'A bossa nova station',
    pick: { kind: 'tag', tags: ['bossa nova', 'mpb', 'latin jazz'] },
    fallbackId: 'rp-world',
    settings: {
      view: null,
      weather: { mode: 'clear', density: 0.2, wind: 0.68 },
      sky: 'day',
      mix: { rain: 0, wind: 0.55, city: 0.1, fire: 0, pad: 0.3, staticBlend: 0.03, hiss: 0.05, cutoff: 1 },
      ambientLinked: false,
      timer: null,
    },
  },
]

export const ATMOSPHERE_BY_ID: Record<string, Atmosphere> = Object.fromEntries(ATMOSPHERES.map((a) => [a.id, a]))

const PICK_TIMEOUT_MS = 6000

/** Stations with a map position first, HTTPS first, keeping popularity order otherwise. */
const rank = (list: Station[]) =>
  [...list].sort((a, b) => Number(b.lat !== null) - Number(a.lat !== null) || Number(b.url.startsWith('https://')) - Number(a.url.startsWith('https://')))

/**
 * A live station for an atmosphere, or its curated fallback when the directory is down
 * (then `standIn` says what it stands in for, so the display can explain).
 */
export async function pickStation(atm: Atmosphere, signal?: AbortSignal): Promise<{ station: Station; standIn: string | null }> {
  const deadline = AbortSignal.timeout(PICK_TIMEOUT_MS)
  const lookup = signal ? AbortSignal.any([signal, deadline]) : deadline
  const curated = FALLBACK_STATIONS.find((s) => s.id === atm.fallbackId) ?? FALLBACK_STATIONS[0]
  const fallback = { station: curated, standIn: musicFrom(atm) }
  if (atm.pick.kind === 'keep') {
    // Nothing to look up: the music that's on stays on (the curated station when nothing is)
    const s = useRadioStore.getState()
    return { station: s.station && s.tuneStatus === 'playing' ? s.station : curated, standIn: null }
  }
  try {
    let found: Station[] = []
    if (atm.pick.kind === 'city') {
      const city = CITY_BY_ID[atm.pick.cityId]
      found = city ? await findStationsForCity(city, lookup) : []
    } else {
      for (const tag of atm.pick.tags) {
        found = await searchByTag(tag, lookup, 20)
        if (found.length) break
      }
    }
    const best = rank(found)[0]
    if (!best) return fallback
    // Neighbours for recovery come from the index, so make sure the pick is in it
    stationIndex.add(found)
    return { station: stationIndex.get(best.id) ?? best, standIn: null }
  } catch {
    return fallback
  }
}
