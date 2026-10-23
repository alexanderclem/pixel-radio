import { LAND_RES } from './detail'
import { spreadOffset } from './stack'

/** Whether a point is on land; null while its tile is still on its way. */
export type LandTest = (lon: number, lat: number) => boolean | null

/** Land tiles requested from the terrain worker at once, so map detail tiles never queue long behind them. */
const MAX_INFLIGHT = 3
/** How far (in land cells, ~430 m each) a station in the water may be moved to reach land. */
export const SNAP_CELLS = 48
/** How much further (in cells) a spot clear of the shoreline may be than the nearest land at all. */
const SHORE_SLACK = 3
/**
 * Pixels per degree where stacks finish fanning out (zoom 120) on a typical screen. A
 * spiral slot's marker sits somewhere along the line out to its offset at this scale: a
 * fraction of it once you zoom further, a little past it on small screens.
 */
const SLOT_PPD = 200
const SLOT_SAMPLES = [0.2, 0.35, 0.5, 0.65, 0.8, 1, 1.25]

/**
 * The 1:10m coastline at the finest detail level, fetched from the terrain worker a 1°
 * tile at a time as stations need it. Tiles that fail to build count as land, so a
 * failure only means stations stay where their coordinates put them.
 */
export class LandMask {
  /** Called whenever tiles arrive */
  onLoad: (() => void) | null = null
  private tiles = new Map<number, Uint8Array>()
  private wanted = new Set<number>()
  private queue: number[] = []
  private inflight = 0
  private fetchTile: (tx: number, ty: number) => Promise<Uint8Array>

  constructor(fetchTile: (tx: number, ty: number) => Promise<Uint8Array>) {
    this.fetchTile = fetchTile
  }

  readonly isLand: LandTest = (lon, lat) => {
    const x = ((((lon + 180) % 360) + 360) % 360)
    const y = Math.min(179.999, Math.max(0, 90 - lat))
    const tx = Math.floor(x)
    const ty = Math.floor(y)
    const key = ty * 360 + tx
    const tile = this.tiles.get(key)
    if (!tile) {
      this.want(key)
      return null
    }
    if (tile.length === 1) return tile[0] === 1
    const cx = Math.min(LAND_RES - 1, Math.floor((x - tx) * LAND_RES))
    const cy = Math.min(LAND_RES - 1, Math.floor((y - ty) * LAND_RES))
    const bit = cy * LAND_RES + cx
    return ((tile[bit >> 3] >> (bit & 7)) & 1) === 1
  }

  private want(key: number) {
    if (this.wanted.has(key)) return
    this.wanted.add(key)
    this.queue.push(key)
    this.pump()
  }

  private pump() {
    while (this.inflight < MAX_INFLIGHT && this.queue.length) {
      const key = this.queue.shift()!
      this.inflight++
      this.fetchTile(key % 360, Math.floor(key / 360))
        .catch(() => Uint8Array.of(1))
        .then((tile) => {
          this.tiles.set(key, tile)
          this.inflight--
          this.pump()
          this.onLoad?.()
        })
    }
  }
}

/**
 * Where a station at (lon, lat) belongs on the map: where it is if that's land, else the
 * centre of the nearest land cell within `radius` cells, preferring cells clear of the
 * shoreline so the marker sits visibly on land. Stays put when there's no land that close
 * (an offshore platform, a ship, an island too small for the coastline data). Null while
 * the land around it is still loading.
 */
export function snapToLand(isLand: LandTest, lon: number, lat: number, radius = SNAP_CELLS): [number, number] | null {
  const here = isLand(lon, lat)
  if (here !== false) return here === null ? null : [lon, lat]
  const c = 1 / LAND_RES
  const x0 = Math.floor((lon + 180) * LAND_RES)
  const y0 = Math.floor((90 - lat) * LAND_RES)
  const at = (x: number, y: number) => isLand((x + 0.5) * c - 180, 90 - (y + 0.5) * c)
  let inland: [number, number] | null = null
  let inlandD = Infinity
  let shore: [number, number] | null = null
  let shoreD = Infinity
  // A clear cell a little further off still beats the very edge, but not one across a strait
  const reach = () => Math.sqrt(shoreD) + SHORE_SLACK
  for (let r = 1; r <= radius && r * r <= inlandD && r <= reach(); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const d = dx * dx + dy * dy
        if (d >= inlandD) continue
        const x = x0 + dx
        const y = y0 + dy
        const land = at(x, y)
        if (land === null) return null
        if (!land) continue
        if (d < shoreD) {
          shoreD = d
          shore = [x, y]
        }
        const n = at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)
        if (n === null) return null
        if (n) {
          inlandD = d
          inland = [x, y]
        }
      }
    }
  }
  const cell = inland && Math.sqrt(inlandD) <= reach() ? inland : shore
  return cell ? [(cell[0] + 0.5) * c - 180, 90 - (cell[1] + 0.5) * c] : [lon, lat]
}

/**
 * Whether spiral slot `k` around a stack at (lon, lat) stays on land everywhere its
 * fanned-out marker can sit as you zoom (null while that land is loading).
 */
export function slotOnLand(isLand: LandTest, lon: number, lat: number, k: number): boolean | null {
  const [ox, oy] = spreadOffset(k, 1)
  for (const f of SLOT_SAMPLES) {
    const land = isLand(lon + (ox * f) / SLOT_PPD, lat - (oy * f) / SLOT_PPD)
    if (land !== true) return land
  }
  return true
}
