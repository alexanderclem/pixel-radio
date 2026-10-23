import { CITIES } from '../constants/cities'
import { MATERIALS, TONES, type Material } from '../constants/palettes'
import { mulberry32 } from '../utils/math'
import { cellLat, cellLon, GRID_H, GRID_W, latToCell, lonToCell } from './worldMask'

export const M = Object.fromEntries(MATERIALS.map((m, i) => [m, i])) as Record<Material, number>

/** 4×4 ordered-dither thresholds in (0,1). */
const BAYER = Float32Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], (v) => (v + 0.5) / 16)
export const bayer = (x: number, y: number) => BAYER[((y & 3) << 2) | (x & 3)]

// --- Noise -----------------------------------------------------------------

const hash2 = (x: number, y: number, seed: number) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function noise2(x: number, y: number, seed: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const tx = x - xi
  const ty = y - yi
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy
}

export function fbm(x: number, y: number, seed: number, octaves: number) {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x, y, seed + o * 17) * amp
    norm += amp
    amp *= 0.5
    x *= 2.03
    y *= 2.03
  }
  return sum / norm
}

// --- Distance to coast -----------------------------------------------------

/**
 * 8-neighbour BFS distance (in cells, capped) from each cell to the nearest cell of the
 * other kind. The world grid wraps east–west; detail tiles don't.
 */
export function coastDistance(mask: Uint8Array, w: number, h: number, cap: number, wrap: boolean): Uint8Array {
  const dist = new Uint8Array(mask.length).fill(cap)
  let frontier: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const m = mask[i]
      const l = x > 0 ? mask[i - 1] : wrap ? mask[i + w - 1] : m
      const r = x < w - 1 ? mask[i + 1] : wrap ? mask[i - w + 1] : m
      const u = y > 0 ? mask[i - w] : m
      const d = y < h - 1 ? mask[i + w] : m
      if (l !== m || r !== m || u !== m || d !== m) {
        dist[i] = 0
        frontier.push(i)
      }
    }
  }
  for (let step = 1; step < cap && frontier.length; step++) {
    const next: number[] = []
    for (const i of frontier) {
      const x = i % w
      const y = (i / w) | 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          let nx = x + dx
          if (nx < 0 || nx >= w) {
            if (!wrap) continue
            nx = (nx + w) % w
          }
          const j = ny * w + nx
          if (dist[j] > step && mask[j] === mask[i]) {
            dist[j] = step
            next.push(j)
          }
        }
      }
    }
    frontier = next
  }
  return dist
}

// --- Mountain ranges -------------------------------------------------------

interface Range {
  pts: [number, number][]
  width: number
  amp: number
}

/** Hand-placed spines of the major ranges (lon, lat), so relief sits where it really is. */
const RANGES: Range[] = [
  { pts: [[71, 36.5], [75, 35], [79, 32.5], [84, 28.8], [88, 27.9], [93, 28.2], [97, 28.5]], width: 2.2, amp: 1.05 },
  { pts: [[78, 34], [86, 33], [93, 33], [99, 32]], width: 4.5, amp: 0.62 }, // Tibetan plateau
  { pts: [[70, 40.5], [76, 41.5], [82, 42.5], [89, 43]], width: 1.8, amp: 0.7 }, // Tian Shan
  { pts: [[67, 36], [71, 37.5], [75, 38.5]], width: 1.6, amp: 0.75 }, // Hindu Kush / Pamir
  { pts: [[44, 37], [48, 34], [52, 31], [56, 28]], width: 1.6, amp: 0.55 }, // Zagros
  { pts: [[40, 43.5], [44, 42.6], [48, 41.5]], width: 1.1, amp: 0.65 }, // Caucasus
  { pts: [[5.5, 44.5], [7, 46], [10, 46.6], [13.5, 47.2], [16, 47.5]], width: 1.1, amp: 0.75 }, // Alps
  { pts: [[-8, 31], [-4, 32.5], [1, 34], [6, 35.5], [9, 36]], width: 1.3, amp: 0.55 }, // Atlas
  { pts: [[37, 7], [38.5, 10], [39.5, 13]], width: 1.8, amp: 0.55 }, // Ethiopian highlands
  { pts: [[5.5, 59], [9, 62], [14, 65.5], [18, 68.5], [21, 69.5]], width: 1.6, amp: 0.5 }, // Scandes
  { pts: [[59, 51], [59.5, 56], [60, 61], [63, 66]], width: 1.2, amp: 0.38 }, // Urals
  { pts: [[-75, 10], [-77, 3], [-78.5, -2], [-76, -10], [-72, -15], [-69, -19], [-68.5, -25], [-70, -33], [-71, -40], [-72.5, -47], [-73, -52]], width: 1.6, amp: 1.0 },
  { pts: [[-69, -16], [-67, -20], [-67, -23]], width: 2.6, amp: 0.65 }, // Altiplano
  { pts: [[-152, 61], [-140, 61], [-130, 57], [-123, 51], [-116, 47], [-112, 43], [-108, 39], [-106, 34]], width: 2.4, amp: 0.8 }, // Rockies
  { pts: [[-122, 48], [-121.5, 44], [-120, 39], [-118.5, 36]], width: 1.0, amp: 0.6 }, // Cascades / Sierra
  { pts: [[-108, 28], [-104, 23], [-100, 19.5], [-97, 18]], width: 1.6, amp: 0.55 }, // Sierra Madre
  { pts: [[-84, 34.5], [-80.5, 37.5], [-77.5, 40.5], [-73, 43.5]], width: 1.4, amp: 0.32 }, // Appalachians
  { pts: [[146.5, -38], [149.5, -33], [151, -29], [148, -21], [145.5, -17]], width: 1.4, amp: 0.36 }, // Great Dividing
  { pts: [[168, -45.5], [171, -43.3], [173.5, -41.5]], width: 0.7, amp: 0.7 }, // Southern Alps
  { pts: [[136, 35], [138.5, 36], [140, 38], [140.5, 40]], width: 0.9, amp: 0.5 }, // Japan Alps
  { pts: [[102, 29], [101, 24], [99, 19]], width: 1.6, amp: 0.45 }, // Hengduan
  { pts: [[-45, 66], [-40, 71], [-38, 76]], width: 6, amp: 0.55 }, // Greenland ice dome
]

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Ridge strength on a coarse 1° grid, bilinearly sampled later. */
function rangeField(): Float32Array {
  const f = new Float32Array(361 * 181)
  for (let y = 0; y <= 180; y++) {
    const lat = 90 - y
    for (let x = 0; x <= 360; x++) {
      const lon = x - 180
      let best = 0
      for (const r of RANGES) {
        for (let k = 0; k < r.pts.length - 1; k++) {
          const [ax, ay] = r.pts[k]
          const [bx, by] = r.pts[k + 1]
          const d = segDist(lon, lat, ax, ay, bx, by) / r.width
          if (d < 3) best = Math.max(best, r.amp * Math.exp(-d * d))
        }
      }
      f[y * 361 + x] = best
    }
  }
  return f
}

const sampleField = (f: Float32Array, lon: number, lat: number) => {
  const x = lon + 180
  const y = 90 - lat
  const xi = Math.min(359, Math.floor(x))
  const yi = Math.min(179, Math.floor(y))
  const tx = x - xi
  const ty = y - yi
  const a = f[yi * 361 + xi]
  const b = f[yi * 361 + xi + 1]
  const c = f[(yi + 1) * 361 + xi]
  const d = f[(yi + 1) * 361 + xi + 1]
  return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty
}

/** Rough desert regions as lon/lat boxes: Sahara–Arabia, Thar, Iran, Gobi/Taklamakan, US southwest, Australia, Kalahari/Namib, Atacama, Patagonia. */
const DESERTS: [number, number, number, number][] = [
  [-17, 15, 58, 33], [62, 22, 75, 31], [53, 26, 66, 37], [76, 36, 115, 46], [53, 37, 66, 45],
  [-118, 25, -103, 38], [114, -32, 145, -18], [11, -29, 26, -17], [-72, -28, -68, -16], [-70, -50, -65, -38],
]

// --- Terrain ---------------------------------------------------------------

export interface Terrain {
  /** material * TONES + tone, per cell */
  idx: Uint8Array
  mask: Uint8Array
  /** BORDER / ADMIN / URBAN bits per cell */
  flags: Uint8Array
}

/** The world grid plus its relief and coast distance, which detail tiles sample but the page never needs. */
export interface BaseTerrain extends Terrain {
  height: Float32Array
  dist: Uint8Array
}

/** Biome noise shared by land and sea ice. */
const biomeNoise = (x: number, y: number) => fbm(x / 18, y / 18, 5, 3)

/**
 * Material for a land point. `x`, `y` are world-grid cell coordinates (fractional on
 * detail tiles, so every level draws the same biome boundaries); `coast` is the distance
 * to the sea in world cells and `shore` says whether the point is right on the coast.
 */
export function landMaterial(x: number, y: number, lon: number, lat: number, h: number, coast: number, shore: boolean): number {
  const alat = Math.abs(lat)
  const n = biomeNoise(x, y)
  const moist = fbm(x / 55, y / 55, 2, 3)
  const greenland = lat > 59 && lon > -60 && lon < -15
  // Ragged edges instead of the boxes' straight lines
  const dl = lon + (fbm(x / 30, y / 30, 13, 2) - 0.5) * 8
  const dt = lat + (fbm(x / 30, y / 30, 17, 2) - 0.5) * 6
  const desert = DESERTS.some(([x0, y0, x1, y1]) => dl >= x0 && dl <= x1 && dt >= y0 && dt <= y1)
  let mat: number
  if (lat < -60 || (greenland && coast > 2) || alat > 76 + n * 4) mat = M.ice
  else if (h > 0.82 || (h > 0.66 && alat > 42)) mat = M.peak
  else if (h > 0.6) mat = M.rock
  else if (alat > 62 + n * 5) mat = M.tundra
  else if (desert && moist < 0.6) mat = M.desert
  else if (desert && moist < 0.7) mat = M.steppe
  else if (alat < 12 + n * 6) mat = moist > 0.42 ? M.jungle : M.grass
  else if ((alat > 47 && alat < 63) || moist > 0.64) mat = M.forest
  else if (moist < 0.34) mat = M.steppe
  else mat = M.grass

  const sandy = mat === M.grass || mat === M.steppe || mat === M.desert || mat === M.jungle || mat === M.forest
  if (shore && sandy && n > 0.42 && alat < 60) mat = M.beach
  return mat
}

/** Sea ice, or -1 for open water; `b` is the ordered-dither threshold. Returns material * TONES + tone. */
export function seaIce(x: number, y: number, lat: number, b: number): number {
  const n = biomeNoise(x, y)
  const alat = Math.abs(lat)
  if (!(alat > 77 + n * 5 || lat < -69 + n * 3)) return -1
  return M.ice * TONES + (n + (b - 0.5) * 0.3 > 0.5 ? 1 : 0)
}

/** Depth ramp dithered across shallow → ocean → deep; `coast` is the distance to land in world cells. */
export function waterDepth(x: number, y: number, coast: number, b: number): number {
  const t = coast / 18 + (fbm(x / 26, y / 26, 3, 3) - 0.5) * 0.5
  const v = t * 2.4 + (b - 0.5) * 0.9
  return v < 0.55 ? M.shallow : v < 1.5 ? M.ocean : M.deep
}

export function buildTerrain(mask: Uint8Array, flags: Uint8Array = new Uint8Array(mask.length)): BaseTerrain {
  const N = GRID_W * GRID_H
  const dist = coastDistance(mask, GRID_W, GRID_H, 28, true)
  const ranges = rangeField()
  const height = new Float32Array(N)

  for (let y = 0; y < GRID_H; y++) {
    const lat = cellLat(y)
    for (let x = 0; x < GRID_W; x++) {
      const i = y * GRID_W + x
      if (!mask[i]) continue
      const lon = cellLon(x)
      const coastRamp = Math.min(1, (dist[i] + 1) / 8)
      const ridged = 1 - Math.abs(fbm(x / 14, y / 14, 11, 3) * 2 - 1)
      const r = sampleField(ranges, lon, lat)
      height[i] = (fbm(x / 40, y / 40, 1, 4) * 0.35 + r * (0.55 + ridged * 0.45)) * coastRamp
    }
  }

  const idx = new Uint8Array(N)
  const H = (x: number, y: number) => height[Math.max(0, Math.min(GRID_H - 1, y)) * GRID_W + ((x + GRID_W) % GRID_W)]

  for (let y = 0; y < GRID_H; y++) {
    const lat = cellLat(y)
    for (let x = 0; x < GRID_W; x++) {
      const i = y * GRID_W + x
      const b = bayer(x, y)
      const d = dist[i]

      if (!mask[i]) {
        const ice = seaIce(x, y, lat, b)
        if (ice >= 0) idx[i] = ice
        else if (d === 0) idx[i] = M.foam * TONES + 1
        else {
          const mat = d === 1 ? M.shallow : waterDepth(x, y, d, b)
          const swell = fbm(x / 7, y / 5, 9, 2)
          idx[i] = mat * TONES + (swell + (b - 0.5) * 0.18 < 0.36 ? 0 : 1)
        }
        continue
      }
      const mat = landMaterial(x, y, cellLon(x), lat, height[i], d, d === 0)
      // Hillshade lit from the north-west, plus canopy speckle on forests
      const slope = (H(x - 1, y - 1) - H(x + 1, y + 1)) * 9
      let shade = slope + (b - 0.5) * 0.14
      if (mat === M.forest || mat === M.jungle) shade += (fbm(x / 2.2, y / 2.2, 21, 2) - 0.5) * 0.5
      else if (mat === M.grass || mat === M.steppe) shade += (fbm(x / 3, y / 3, 23, 2) - 0.5) * 0.22
      idx[i] = mat * TONES + (shade > 0.08 ? 2 : shade < -0.08 ? 0 : 1)
    }
  }
  return { idx, mask, flags, height, dist }
}

/**
 * Night lights: every radio station lights its cell with a soft halo, so the night side
 * glows where people actually broadcast, plus scattered towns and the preset cities.
 */
export function buildLights(mask: Uint8Array, points: Iterable<{ lon: number | null; lat: number | null }>): Uint8Array {
  const lights = new Uint8Array(mask.length)
  const add = (x: number, y: number, v: number) => {
    if (y < 0 || y >= GRID_H) return
    const i = y * GRID_W + ((x + GRID_W) % GRID_W)
    if (mask[i]) lights[i] = Math.min(255, lights[i] + v)
  }
  const rand = mulberry32(42)
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] && Math.abs(cellLat((i / GRID_W) | 0)) < 60 && rand() < 0.004) lights[i] = 50 + rand() * 80
  }
  const splat = (lon: number, lat: number, v: number) => {
    const x = lonToCell(lon)
    const y = latToCell(lat)
    add(x, y, v)
    add(x - 1, y, v * 0.4)
    add(x + 1, y, v * 0.4)
    add(x, y - 1, v * 0.4)
    add(x, y + 1, v * 0.4)
    add(x - 1, y - 1, v * 0.15)
    add(x + 1, y + 1, v * 0.15)
    add(x + 1, y - 1, v * 0.15)
    add(x - 1, y + 1, v * 0.15)
  }
  for (const p of points) if (p.lon !== null && p.lat !== null) splat(p.lon, p.lat, 120)
  for (const c of CITIES) {
    for (let k = 0; k < 30; k++) {
      const r = Math.abs(rand() + rand() - 1) * 1.8
      const a = rand() * Math.PI * 2
      splat(c.lon + Math.cos(a) * r, c.lat + Math.sin(a) * r * 0.7, 90)
    }
  }
  return lights
}

/** Tileable 256² fbm used for drifting clouds. */
export function buildCloudTexture(): Float32Array {
  const S = 256
  const tex = new Float32Array(S * S)
  const octaves = [
    { period: 4, amp: 0.5 },
    { period: 8, amp: 0.26 },
    { period: 16, amp: 0.14 },
    { period: 32, amp: 0.1 },
  ]
  for (const { period, amp } of octaves) {
    const rand = mulberry32(period * 977)
    const lattice = Float32Array.from({ length: period * period }, () => rand())
    const cell = S / period
    for (let y = 0; y < S; y++) {
      const gy = y / cell
      const y0 = Math.floor(gy)
      const ty = gy - y0
      const sy = ty * ty * (3 - 2 * ty)
      for (let x = 0; x < S; x++) {
        const gx = x / cell
        const x0 = Math.floor(gx)
        const tx = gx - x0
        const sx = tx * tx * (3 - 2 * tx)
        const L = (xx: number, yy: number) => lattice[(yy % period) * period + (xx % period)]
        const a = L(x0, y0)
        const b = L(x0 + 1, y0)
        const c = L(x0, y0 + 1)
        const d = L(x0 + 1, y0 + 1)
        tex[y * S + x] += (a + (b - a) * sx + (c - a + (a - b - c + d) * sx) * sy) * amp
      }
    }
  }
  return tex
}
