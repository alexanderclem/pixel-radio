import { smoothstep } from '../utils/math'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
/** Spacing of the spiral that stacked stations fan out on (internal px). */
export const SPREAD_PX = 14

/** How far stations sharing one spot have fanned out at this zoom (0..1). */
export const spreadAt = (zoom: number) => smoothstep(30, 120, zoom)

/**
 * Screen offset for the `rank`-th station at a shared spot: the first stays put, the
 * rest sit on a sunflower spiral around it so each gets its own marker.
 */
export function spreadOffset(rank: number, spread: number): [number, number] {
  if (rank <= 0 || spread <= 0) return [0, 0]
  const r = SPREAD_PX * Math.sqrt(rank) * spread
  const a = rank * GOLDEN_ANGLE
  return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)]
}

/** How far past the halfway point between octaves the zoom must go before clusters regroup. */
const LEVEL_HYSTERESIS = 0.15

/**
 * Whole-octave zoom level that station clusters are binned at. It only changes once the
 * zoom is clearly nearer the next octave, so easing or wobbling across a boundary doesn't
 * make every badge regroup back and forth.
 */
export function clusterLevel(zoom: number, prev: number) {
  const z = Math.log2(zoom)
  return Math.abs(z - prev) < 0.5 + LEVEL_HYSTERESIS ? prev : Math.round(z)
}
