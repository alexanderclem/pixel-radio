import { searchStations } from '../services/radioBrowser'
import { stationIndex } from '../services/stationIndex'
import { useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { playSetup } from './play'

/** Short curated routes around the map, one station per stop. */
export interface JourneyStop {
  /** Name to search the directory for */
  name: string
  /** ISO country code, to keep the search honest */
  country: string
  city: string
  note: string
}

export interface Journey {
  id: string
  name: string
  description: string
  stops: JourneyStop[]
}

export const JOURNEYS: Journey[] = [
  {
    id: 'jazz-around-the-world',
    name: 'Jazz Around the World',
    description: 'Six jazz stations, from Paris to Sydney.',
    stops: [
      { name: 'TSF Jazz', country: 'FR', city: 'Paris', note: "Paris's round-the-clock jazz station." },
      { name: 'Jazz FM', country: 'GB', city: 'London', note: 'Jazz, soul and blues from London.' },
      { name: 'Radio Swiss Jazz', country: 'CH', city: 'Switzerland', note: 'Commercial-free jazz from Swiss public radio.' },
      { name: 'WBGO', country: 'US', city: 'Newark', note: "Newark's public jazz station." },
      { name: 'Jazz24', country: 'US', city: 'Seattle', note: 'Jazz all day from the Pacific Northwest.' },
      { name: 'ABC Jazz', country: 'AU', city: 'Sydney', note: "The Australian Broadcasting Corporation's jazz channel." },
    ],
  },
  {
    id: 'college-radio',
    name: 'Independent College Radio',
    description: 'Student and volunteer stations that play what they like.',
    stops: [
      { name: 'WXYC', country: 'US', city: 'Chapel Hill', note: "UNC's student station, an early internet broadcaster." },
      { name: 'WMBR', country: 'US', city: 'Cambridge', note: "MIT's student-run station." },
      { name: 'WREK', country: 'US', city: 'Atlanta', note: "Georgia Tech's student station." },
      { name: 'KALX', country: 'US', city: 'Berkeley', note: "UC Berkeley's volunteer-run station." },
      { name: 'KXLU', country: 'US', city: 'Los Angeles', note: "Loyola Marymount's student station." },
      { name: 'CiTR', country: 'CA', city: 'Vancouver', note: "UBC's campus and community station." },
    ],
  },
]

export const JOURNEY_BY_ID: Record<string, Journey> = Object.fromEntries(JOURNEYS.map((j) => [j.id, j]))

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The directory's best match for a stop: the name must really match, placed and HTTPS first. */
export async function findStop(stop: JourneyStop, signal?: AbortSignal): Promise<Station | null> {
  try {
    const found = await searchStations(stop.name, signal ?? AbortSignal.timeout(6000), 15, stop.country)
    const want = squash(stop.name)
    const matches = found.filter((s) => squash(s.name).includes(want))
    matches.sort((a, b) => Number(b.lat !== null) - Number(a.lat !== null) || Number(b.url.startsWith('https://')) - Number(a.url.startsWith('https://')))
    const best = matches[0]
    if (!best) return null
    stationIndex.add(found)
    return stationIndex.get(best.id) ?? best
  } catch {
    return null
  }
}

/**
 * Play a journey from a stop. Stops that can't be found are skipped with a note; when none
 * of the rest can be, the journey says so and ends.
 */
export async function playJourney(journey: Journey, from = 0) {
  const store = useRadioStore.getState()
  const skipped: string[] = []
  const locate = (async () => {
    for (let i = from; i < journey.stops.length; i++) {
      const station = await findStop(journey.stops[i])
      if (station) return { station, index: i }
      skipped.push(journey.stops[i].name)
    }
    return null
  })()
  await playSetup(locate.then((r) => r?.station ?? null), {})
  const result = await locate
  if (skipped.length) store.showToast(`${skipped.join(', ')} ${skipped.length === 1 ? "isn't" : "aren't"} on the air right now, skipped`)
  useRadioStore.getState().setJourney(result ? { id: journey.id, index: result.index } : null)
  if (!result) store.showToast(`Couldn't reach any more stops on ${journey.name}`)
}
