import { AVATAR_SLOTS, PARTS, type AvatarSlot, type PartFilter, type Unlock } from '../avatar/parts'
import type { Totals } from './progress'

const VALUE: Record<Unlock['kind'], (t: Totals) => number> = {
  focusHours: (t) => t.focusHours,
  togetherHours: (t) => t.togetherHours,
  streak: (t) => t.streak,
  countries: (t) => t.countries,
  stations: (t) => t.stations,
  boatTrips: (t) => t.boatTrips,
  flights: (t) => t.flights,
  balloonRides: (t) => t.balloonRides,
}

const WHAT: Record<Unlock['kind'], (n: number) => string> = {
  focusHours: (n) => `Focus for ${n} hours`,
  togetherHours: (n) => `Focus with friends for ${n} hours`,
  streak: (n) => `Focus ${n} days in a row`,
  countries: (n) => `Listen to stations in ${n} countries`,
  stations: (n) => `Listen to ${n} stations`,
  boatTrips: (n) => `Row across water ${n} times`,
  flights: (n) => `Fly ${n} times`,
  balloonRides: (n) => (n === 1 ? 'Ride a hot-air balloon' : `Ride a hot-air balloon ${n} times`),
}

export const unlockLabel = (u: Unlock) => WHAT[u.kind](u.n)
export const unlockProgress = (u: Unlock, t: Totals) => Math.min(u.n, Math.floor(VALUE[u.kind](t) * 10) / 10)
export const isEarned = (u: Unlock | undefined, t: Totals) => !u || VALUE[u.kind](t) >= u.n

/** Parts this listener may wear right now. */
export const earnedParts = (t: Totals): PartFilter => (slot, index) => isEarned(PARTS[slot][index]?.unlock, t)

export interface EarnablePart {
  key: string
  slot: AvatarSlot
  index: number
  name: string
  unlock: Unlock
}

export const EARNABLE: EarnablePart[] = AVATAR_SLOTS.flatMap((slot) =>
  PARTS[slot].flatMap((p, index) => (p.unlock ? [{ key: `${slot}:${index}`, slot, index, name: p.name, unlock: p.unlock }] : [])),
)

/** Parts earned but not yet announced. */
export const newlyEarned = (t: Totals, celebrated: string[]) => EARNABLE.filter((p) => isEarned(p.unlock, t) && !celebrated.includes(p.key))
