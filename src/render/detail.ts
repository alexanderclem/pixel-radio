import { TONES } from '../constants/palettes'
import type { Shape } from './geoData'
import { bayer, coastDistance, fbm, landMaterial, M, seaIce, waterDepth, type BaseTerrain } from './terrain'
import { fillRings, GRID_H, GRID_W, rasterCanvas, readMask } from './worldMask'

/** Cell flag bits, shared by the world grid and detail tiles. */
export const BORDER = 1
export const ADMIN = 2
export const URBAN = 4

export interface Level {
  cellDeg: number
  /** Cells per tile side (0 for the world grid, which is one big tile) */
  size: number
}

/** Level 0 is the quarter-degree world grid; each detail level is 4× finer. */
export const LEVELS: readonly Level[] = [
  { cellDeg: 1 / 4, size: 0 },
  { cellDeg: 1 / 16, size: 240 }, // 15° tiles, ~7 km cells
  { cellDeg: 1 / 64, size: 256 }, // 4° tiles, ~1.7 km cells
  { cellDeg: 1 / 256, size: 256 }, // 1° tiles, ~430 m cells
]

export const tileDeg = (level: number) => LEVELS[level].cellDeg * LEVELS[level].size

/** Finest level whose cells still cover at least one screen pixel. */
export function levelFor(ppd: number): number {
  for (let l = LEVELS.length - 1; l > 0; l--) if (ppd * LEVELS[l].cellDeg >= 1) return l
  return 0
}

export const tileKey = (level: number, tx: number, ty: number) => `${level}:${tx}:${ty}`

export function tileBounds(level: number, tx: number, ty: number) {
  const deg = tileDeg(level)
  return { west: -180 + tx * deg, north: 90 - ty * deg, deg }
}

/** Tiles of `level` overlapping a lon/lat box, nearest the box centre first. */
export function visibleTiles(level: number, west: number, north: number, east: number, south: number) {
  const deg = tileDeg(level)
  const cols = Math.round(360 / deg)
  const rows = Math.round(180 / deg)
  const tx0 = Math.max(0, Math.floor((west + 180) / deg))
  const tx1 = Math.min(cols - 1, Math.floor((east + 180) / deg))
  const ty0 = Math.max(0, Math.floor((90 - north) / deg))
  const ty1 = Math.min(rows - 1, Math.floor((90 - south) / deg))
  const cx = (west + east) / 2
  const cy = (north + south) / 2
  const out: { tx: number; ty: number; d: number }[] = []
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const d = Math.hypot(-180 + (tx + 0.5) * deg - cx, 90 - (ty + 0.5) * deg - cy)
      out.push({ tx, ty, d })
    }
  }
  return out.sort((a, b) => a.d - b.d).map(({ tx, ty }) => ({ tx, ty }))
}

/**
 * Bresenham a polyline (in cell coordinates) into `flags`, dashed: of every `period`
 * cells along the line the first `on` are set.
 */
export function rasterLine(flags: Uint8Array, w: number, h: number, pts: [number, number][], bit: number, period: number, on: number) {
  let k = 0
  for (let s = 0; s < pts.length - 1; s++) {
    let x0 = Math.floor(pts[s][0])
    let y0 = Math.floor(pts[s][1])
    const x1 = Math.floor(pts[s + 1][0])
    const y1 = Math.floor(pts[s + 1][1])
    // Skip segments entirely off one side of the grid
    if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 >= w && x1 >= w) || (y0 >= h && y1 >= h)) continue
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      if (x0 >= 0 && x0 < w && y0 >= 0 && y0 < h && k % period < on) flags[y0 * w + x0] |= bit
      if (x0 === x1 && y0 === y1) break
      k++
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }
}

/** Calls `fn` for every shape (and ±360° copy) whose box overlaps the given box. */
function eachOverlapping(shapes: Shape[], west: number, south: number, east: number, north: number, fn: (s: Shape, shift: number) => void) {
  for (const s of shapes) {
    const [w, so, e, n] = s.box
    if (so > north || n < south) continue
    for (const shift of [-360, 0, 360]) if (w + shift <= east && e + shift >= west) fn(s, shift)
  }
}

/** Rasterise line shapes onto a grid whose top-left corner is (west, north). */
export function rasterShapes(
  flags: Uint8Array, w: number, h: number, shapes: Shape[],
  west: number, north: number, cellDeg: number, bit: number, period: number, on: number,
) {
  eachOverlapping(shapes, west, north - h * cellDeg, west + w * cellDeg, north, (s, shift) => {
    for (const part of s.parts) {
      const pts = part.map(([lon, lat]) => [(lon + shift - west) / cellDeg, (north - lat) / cellDeg] as [number, number])
      rasterLine(flags, w, h, pts, bit, period, on)
    }
  })
}

/** Country borders baked into the world grid. */
export function baseFlags(borders: Shape[]): Uint8Array {
  const flags = new Uint8Array(GRID_W * GRID_H)
  rasterShapes(flags, GRID_W, GRID_H, borders, -180, 90, LEVELS[0].cellDeg, BORDER, 3, 2)
  return flags
}

export interface DetailTile {
  level: number
  tx: number
  ty: number
  idx: Uint8Array
  flags: Uint8Array
  /** Built-up glow before stations are added */
  lights: Uint8Array
}

export interface DetailSources {
  land: Shape[]
  urban: Shape[]
  borders: Shape[]
  admin: Shape[]
}

const PAD = 4

/**
 * One detail tile: 1:10m coastline and urban areas rasterised at the tile's resolution,
 * borders and state lines on top, and materials from the world grid's own rules evaluated
 * at fractional grid coordinates, so biome and depth edges stay smooth at every level.
 */
export function buildTile(base: BaseTerrain, geo: DetailSources, level: number, tx: number, ty: number): DetailTile {
  const n = LEVELS[level].size
  const c = LEVELS[level].cellDeg
  const { west, north } = tileBounds(level, tx, ty)
  const W = n + PAD * 2
  const pw = west - PAD * c
  const pn = north + PAD * c

  const ctx = rasterCanvas(W, W)
  const fill = (shapes: Shape[]) => {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, W)
    ctx.fillStyle = '#fff'
    eachOverlapping(shapes, pw, pn - W * c, pw + W * c, pn, (s, shift) => {
      fillRings(ctx, s.parts, (lon) => (lon + shift - pw) / c, (lat) => (pn - lat) / c)
    })
    return readMask(ctx, W, W)
  }
  const mask = fill(geo.land)
  const urban = fill(geo.urban)
  const dist = coastDistance(mask, W, W, 6, false)

  const flags = new Uint8Array(n * n)
  rasterShapes(flags, n, n, geo.admin, west, north, c, ADMIN, 2, 1)
  rasterShapes(flags, n, n, geo.borders, west, north, c, BORDER, 3, 2)

  // Fine relief noise on a 1-cell-padded grid so slopes can look at neighbours
  const R = n + 2
  const rough = new Float32Array(R * R)
  const gx0 = tx * n
  const gy0 = ty * n
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) rough[y * R + x] = fbm((gx0 + x) / 5, (gy0 + y) / 5, 61, 2)

  /** Bilinear sample of a world-grid field at fractional cell coordinates. */
  const sample = (at: (i: number) => number, bx: number, by: number) => {
    const x0 = Math.floor(bx)
    const y0 = Math.max(0, Math.min(GRID_H - 2, Math.floor(by)))
    const fx = bx - x0
    const fy = Math.max(0, Math.min(1, by - y0))
    const xa = (x0 + GRID_W) % GRID_W
    const xb = (x0 + 1 + GRID_W) % GRID_W
    const a = at(y0 * GRID_W + xa)
    const b = at(y0 * GRID_W + xb)
    const cc = at((y0 + 1) * GRID_W + xa)
    const d = at((y0 + 1) * GRID_W + xb)
    return a + (b - a) * fx + (cc - a + (a - b - cc + d) * fx) * fy
  }
  const height = (i: number) => base.height[i]
  const seaDist = (i: number) => (base.mask[i] ? 0 : base.dist[i])
  const landDist = (i: number) => (base.mask[i] ? base.dist[i] : 0)
  const H = (bx: number, by: number) => sample(height, bx, by)

  const street = level === 1 ? 0 : level === 2 ? 3 : 4
  /** Fine cells per world-grid cell */
  const scale = LEVELS[0].cellDeg / c
  const idx = new Uint8Array(n * n)
  const lights = new Uint8Array(n * n)
  for (let y = 0; y < n; y++) {
    const lat = north - (y + 0.5) * c
    // World-grid coordinates, so noise and classification match the coarser levels
    const by = (90 - lat) * 4 - 0.5
    const gy = gy0 + y
    for (let x = 0; x < n; x++) {
      const lon = west + (x + 0.5) * c
      const bx = (lon + 180) * 4 - 0.5
      const gx = gx0 + x
      const pi = (y + PAD) * W + x + PAD
      const j = y * n + x
      const b = bayer(x, y)
      const d = dist[pi]

      if (!mask[pi]) {
        const ice = seaIce(bx, by, lat, b)
        if (ice >= 0) idx[j] = ice
        else if (d === 0) idx[j] = M.foam * TONES + 1
        else {
          const mat = d <= 1 ? M.shallow : waterDepth(bx, by, Math.max(d / scale, sample(seaDist, bx, by)), b)
          // Thin wave streaks rather than the world grid's broad swell
          idx[j] = mat * TONES + (fbm(gx / 12, gy / 3, 9, 2) + (b - 0.5) * 0.18 < 0.32 ? 0 : 1)
        }
        continue
      }

      const h = H(bx, by)
      let mat = landMaterial(bx, by, lon, lat, h, sample(landDist, bx, by), d <= 1)
      let tone: number
      if (urban[pi] && mat !== M.ice && mat !== M.peak) {
        mat = M.urban
        flags[j] |= URBAN
        const speck = fbm(gx / 1.7, gy / 1.7, 71, 2)
        const road = street > 0 && (gx % street === 0 || gy % street === 0)
        tone = road ? 2 : speck + (b - 0.5) * 0.2 > 0.5 ? 1 : 0
        lights[j] = road ? 190 : street ? 40 + speck * 60 : 70 + speck * 150
      } else {
        // Same lighting as the world grid: north-west sun on the relief, plus fine roughness
        const r = (y + 1) * R + x + 1
        let shade = (H(bx - 1, by - 1) - H(bx + 1, by + 1)) * 9
        shade += (rough[r - R - 1] - rough[r + R + 1]) * (0.25 + h * 1.2) + (b - 0.5) * 0.14
        if (mat === M.forest || mat === M.jungle) shade += (fbm(gx / 2.2, gy / 2.2, 21, 2) - 0.5) * 0.5
        else if (mat === M.grass || mat === M.steppe) shade += (fbm(gx / 3, gy / 3, 23, 2) - 0.5) * 0.22
        tone = shade > 0.08 ? 2 : shade < -0.08 ? 0 : 1
      }
      idx[j] = mat * TONES + tone
    }
  }
  return { level, tx, ty, idx, flags, lights }
}
