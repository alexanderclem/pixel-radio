import { AVATAR_SLOTS, PARTS, type AvatarSlot } from './parts'

/**
 * Milestones that earn extra avatar parts. Progress is counted on this device (and
 * merged across devices for account holders); unlocks are cosmetic, so nothing here
 * is checked by the server.
 */

export type UnlockId = 'sailor' | 'pilot' | 'aeronaut' | 'scholar' | 'globetrotter' | 'tuner' | 'social'

export interface Progress {
  boatTrips: number
  flights: number
  balloonRides: number
  /** Focus sessions finished, all time */
  focusSessions: number
  /** Country codes of stations played */
  countries: string[]
  /** Ids of different stations played (capped) */
  stations: string[]
  /** Most friends at once */
  friends: number
}

export const MAX_TRACKED_STATIONS = 100
const MAX_COUNTRIES = 250

export const EMPTY_PROGRESS: Progress = { boatTrips: 0, flights: 0, balloonRides: 0, focusSessions: 0, countries: [], stations: [], friends: 0 }

export interface Unlock {
  id: UnlockId
  title: string
  hint: string
  need: number
  count: (p: Progress) => number
}

export const UNLOCKS: Unlock[] = [
  { id: 'sailor', title: 'Sailor', hint: 'Row across water 3 times', need: 3, count: (p) => p.boatTrips },
  { id: 'pilot', title: 'Pilot', hint: 'Fly 3 times', need: 3, count: (p) => p.flights },
  { id: 'aeronaut', title: 'Aeronaut', hint: 'Ride a hot-air balloon', need: 1, count: (p) => p.balloonRides },
  { id: 'scholar', title: 'Scholar', hint: 'Finish 10 focus sessions', need: 10, count: (p) => p.focusSessions },
  { id: 'globetrotter', title: 'Globetrotter', hint: 'Listen in 10 countries', need: 10, count: (p) => p.countries.length },
  { id: 'tuner', title: 'Dial hopper', hint: 'Play 50 different stations', need: 50, count: (p) => p.stations.length },
  { id: 'social', title: 'Social', hint: 'Have 3 friends', need: 3, count: (p) => p.friends },
]

const UNLOCK_IDS = new Set<string>(UNLOCKS.map((u) => u.id))

/** The part each unlock earns. */
export function rewardOf(id: UnlockId): { slot: AvatarSlot; index: number; name: string } | null {
  for (const slot of AVATAR_SLOTS) {
    const index = PARTS[slot].findIndex((p) => p.unlock === id)
    if (index >= 0) return { slot, index, name: PARTS[slot][index].name }
  }
  return null
}

export const isPartUnlocked = (slot: AvatarSlot, index: number, unlocks: readonly UnlockId[]) => {
  const needs = PARTS[slot][index]?.unlock
  return !needs || unlocks.includes(needs)
}

/** Unlocks the progress has earned that aren't in `have` yet. */
export const evaluateUnlocks = (p: Progress, have: readonly UnlockId[]): UnlockId[] =>
  UNLOCKS.filter((u) => !have.includes(u.id) && u.count(p) >= u.need).map((u) => u.id)

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
const strings = (v: unknown, test: RegExp, max: number) =>
  Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === 'string' && test.test(s)))].slice(0, max) : []

export function sanitizeProgress(v: unknown): Progress {
  if (!isObject(v)) return EMPTY_PROGRESS
  return {
    boatTrips: count(v.boatTrips),
    flights: count(v.flights),
    balloonRides: count(v.balloonRides),
    focusSessions: count(v.focusSessions),
    countries: strings(v.countries, /^[A-Z]{2}$/, MAX_COUNTRIES),
    stations: strings(v.stations, /^[A-Za-z0-9_:.-]{1,80}$/, MAX_TRACKED_STATIONS),
    friends: count(v.friends),
  }
}

export const sanitizeUnlocks = (v: unknown): UnlockId[] =>
  Array.isArray(v) ? [...new Set(v.filter((id): id is UnlockId => typeof id === 'string' && UNLOCK_IDS.has(id)))] : []

/** Combine progress from two devices: the larger count wins, lists are joined. */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const join = (x: string[], y: string[], max: number) => [...new Set([...x, ...y])].slice(0, max)
  return {
    boatTrips: Math.max(a.boatTrips, b.boatTrips),
    flights: Math.max(a.flights, b.flights),
    balloonRides: Math.max(a.balloonRides, b.balloonRides),
    focusSessions: Math.max(a.focusSessions, b.focusSessions),
    countries: join(a.countries, b.countries, MAX_COUNTRIES),
    stations: join(a.stations, b.stations, MAX_TRACKED_STATIONS),
    friends: Math.max(a.friends, b.friends),
  }
}
