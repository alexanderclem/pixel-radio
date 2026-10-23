/** How an avatar gets somewhere: on foot, rowing over water, or flying for long trips. */
export type TravelMode = 'walk' | 'boat' | 'plane' | 'balloon'

/** Land test for a map position (the terrain mask once it has loaded). */
export type IsLand = (lon: number, lat: number) => boolean

/** Degrees of longitude/latitude covered per second, by mode. */
const SPEED: Record<TravelMode, number> = { walk: 30, boat: 6, plane: 35, balloon: 18 }
/** Extra seconds for boarding and pushing off, or climbing and descending. */
const CLIMB: Record<TravelMode, number> = { walk: 0, boat: 0.8, plane: 1.5, balloon: 2 }
const MIN_TRIP = 1.2
const MAX_TRIP: Record<TravelMode, number> = { walk: 8, boat: 10, plane: 9, balloon: 12 }

/** Trips at least this long always fly. */
const FLY_DISTANCE = 70
/** Open water at least this wide is flown over rather than rowed. */
const FLY_WATER = 25
/** Narrower water (rivers, coastline noise) is just walked through. */
const MIN_WATER = 1.5
/** Islands smaller than this in the middle of a crossing don't interrupt the boat. */
const MIN_ISLAND = 1
const SAMPLE_DEG = 0.5

export interface WalkTarget {
  id: string
  lon: number
  lat: number
}

export interface Leg {
  mode: TravelMode
  fromLon: number
  fromLat: number
  toLon: number
  toLat: number
  duration: number
}

export interface WalkerPosition {
  id: string
  lon: number
  lat: number
  /** Moving at all, by any mode */
  walking: boolean
  mode: TravelMode | 'idle'
  /** 0 on the ground or water, 1 at cruising height */
  altitude: number
  /** 1 facing east, -1 facing west */
  facing: 1 | -1
}

interface WalkState {
  legs: Leg[]
  toLon: number
  toLat: number
  start: number
  facing: 1 | -1
  /** Last leg whose departure was reported */
  announced: number
}

const ease = (x: number) => x * x * (3 - 2 * x)
const smooth = (a: number, b: number, x: number) => ease(Math.min(1, Math.max(0, (x - a) / (b - a))))

/** Height through a flight leg: planes climb and descend briskly, balloons take their time. */
const altitudeOf = (mode: TravelMode, k: number) => {
  if (mode === 'plane') return smooth(0, 0.2, k) * (1 - smooth(0.8, 1, k))
  if (mode === 'balloon') return smooth(0, 0.3, k) * (1 - smooth(0.7, 1, k))
  return 0
}

/** Stable per person and destination, so the same trip always picks the same aircraft. */
function flightMode(id: string, lon: number, lat: number, distance: number): TravelMode {
  const key = `${id}|${lon.toFixed(2)},${lat.toFixed(2)}`
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return distance < 150 && (h >>> 0) % 4 === 0 ? 'balloon' : 'plane'
}

/**
 * Plan a trip as legs along the straight line between two points. Long trips and wide
 * oceans fly; shorter water crossings walk to the coast, row across and walk on.
 * Without a land test (terrain still loading) only distance decides.
 */
export function planTrip(
  id: string,
  from: { lon: number; lat: number },
  to: { lon: number; lat: number },
  isLand?: IsLand | null,
  airborne = false,
): Leg[] {
  const distance = Math.hypot(to.lon - from.lon, to.lat - from.lat)
  if (distance === 0) return []
  const leg = (mode: TravelMode, a: number, b: number): Leg => ({
    mode,
    fromLon: from.lon + (to.lon - from.lon) * a,
    fromLat: from.lat + (to.lat - from.lat) * a,
    toLon: from.lon + (to.lon - from.lon) * b,
    toLat: from.lat + (to.lat - from.lat) * b,
    duration: (distance * (b - a)) / SPEED[mode] + CLIMB[mode],
  })
  const finish = (legs: Leg[]) => {
    const total = legs.reduce((sum, l) => sum + l.duration, 0)
    const cap = Math.max(...legs.map((l) => MAX_TRIP[l.mode]))
    const scale = total < MIN_TRIP ? MIN_TRIP / total : total > cap ? cap / total : 1
    return legs.map((l) => ({ ...l, duration: l.duration * scale }))
  }
  const fly = () => finish([leg(flightMode(id, to.lon, to.lat, distance), 0, 1)])

  if (airborne || distance >= FLY_DISTANCE) return fly()
  if (!isLand) return finish([leg('walk', 0, 1)])

  // Classify each sample segment by its midpoint, then group into land and water runs
  const steps = Math.max(2, Math.ceil(distance / SAMPLE_DEG))
  const segment = distance / steps
  const runs: { water: boolean; start: number; end: number }[] = []
  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps
    const water = !isLand(from.lon + (to.lon - from.lon) * f, from.lat + (to.lat - from.lat) * f)
    const last = runs[runs.length - 1]
    if (last && last.water === water) last.end = i + 1
    else runs.push({ water, start: i, end: i + 1 })
  }
  const length = (r: { start: number; end: number }) => (r.end - r.start) * segment
  // Narrow water is waded; tiny islands mid-crossing are rowed past
  for (const [i, r] of runs.entries()) {
    if (r.water && length(r) < MIN_WATER) r.water = false
    else if (!r.water && length(r) < MIN_ISLAND && runs[i - 1]?.water && runs[i + 1]?.water) r.water = true
  }
  const merged: typeof runs = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && last.water === r.water) last.end = r.end
    else merged.push({ ...r })
  }
  if (merged.some((r) => r.water && length(r) >= FLY_WATER)) return fly()
  return finish(merged.map((r) => leg(r.water ? 'boat' : 'walk', r.start / steps, r.end / steps)))
}

/**
 * Moves avatars between stations. Someone appearing for the first time starts at
 * their station; a new station starts a trip from wherever they currently are.
 */
export class AvatarWalker {
  private states = new Map<string, WalkState>()
  private isLand: IsLand | null = null
  /** Called once when someone sets off by boat, plane or balloon */
  onDepart: ((id: string, mode: TravelMode) => void) | null = null

  setLand(isLand: IsLand | null) {
    this.isLand = isLand
  }

  private positionOf(s: WalkState, t: number) {
    let elapsed = t - s.start
    for (const [index, l] of s.legs.entries()) {
      if (elapsed < l.duration) {
        const k = Math.max(0, elapsed / l.duration)
        const e = ease(k)
        return {
          lon: l.fromLon + (l.toLon - l.fromLon) * e,
          lat: l.fromLat + (l.toLat - l.fromLat) * e,
          walking: true,
          mode: l.mode,
          altitude: altitudeOf(l.mode, k),
          index,
        }
      }
      elapsed -= l.duration
    }
    return { lon: s.toLon, lat: s.toLat, walking: false, mode: 'idle' as const, altitude: 0, index: s.legs.length }
  }

  update(targets: readonly WalkTarget[], t: number): WalkerPosition[] {
    const seen = new Set<string>()
    const out: WalkerPosition[] = []
    for (const target of targets) {
      seen.add(target.id)
      let state = this.states.get(target.id)
      if (!state) {
        state = { legs: [], toLon: target.lon, toLat: target.lat, start: t, facing: 1, announced: 0 }
        this.states.set(target.id, state)
      } else if (state.toLon !== target.lon || state.toLat !== target.lat) {
        const here = this.positionOf(state, t)
        const dx = target.lon - here.lon
        // Already in the air: carry on flying rather than dropping into the sea
        const legs = planTrip(target.id, here, target, this.isLand, here.altitude > 0.05)
        state = { legs, toLon: target.lon, toLat: target.lat, start: t, facing: dx < 0 ? -1 : dx > 0 ? 1 : state.facing, announced: -1 }
        this.states.set(target.id, state)
      }
      const { index, ...position } = this.positionOf(state, t)
      if (index > state.announced && index < state.legs.length) {
        state.announced = index
        const mode = state.legs[index].mode
        if (mode !== 'walk') this.onDepart?.(target.id, mode)
      }
      out.push({ id: target.id, ...position, facing: state.facing })
    }
    for (const id of this.states.keys()) if (!seen.has(id)) this.states.delete(id)
    return out
  }
}
