import { TONES, type Palette } from '../constants/palettes'
import { mulberry32 } from '../utils/math'
import { ADMIN, BORDER } from './detail'
import { bayer, M } from './terrain'

const RAD = Math.PI / 180

/** A grid of terrain cells to recolour: the world grid or one detail tile. */
export interface ShadeTarget {
  /** Cells per row */
  stride: number
  idx: Uint8Array
  flags: Uint8Array
  lights: Uint8Array
  out: Uint32Array
  rowLat: Float32Array
  rowSin: Float32Array
  rowCos: Float32Array
  /** Row/column position in world-grid cells, so clouds line up across levels */
  rowCloud: Float32Array
  colLon: Float32Array
  colCloud: Float32Array
  /** cos(lon − subsolar lon), refreshed each frame */
  colCos: Float32Array
  /** 0 on the world grid; 1 dithers cloud texel edges on finer grids */
  cloudJitter: number
}

export interface ShadeFrame {
  p: Palette
  table: Uint8Array
  cloud: Float32Array
  sinDec: number
  cosDec: number
  t: number
  /** Cloud opacity after zoom fade */
  cloudAlpha: number
}

const rand = mulberry32(99)
/** Random phases for ocean glints, indexed by the low bits of the cell index. */
const GLINT = Uint8Array.from({ length: 65536 }, () => (rand() * 256) | 0)

const pack = (r: number, g: number, b: number) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)

export function initRows(g: ShadeTarget, lats: (y: number) => number) {
  for (let y = 0; y < g.rowLat.length; y++) {
    const lat = lats(y)
    g.rowLat[y] = lat
    g.rowSin[y] = Math.sin(lat * RAD)
    g.rowCos[y] = Math.cos(lat * RAD)
    g.rowCloud[y] = (90 - lat) * 4 - 0.5
  }
}

export function initCols(g: ShadeTarget, lons: (x: number) => number) {
  for (let x = 0; x < g.colLon.length; x++) {
    const lon = lons(x)
    g.colLon[x] = lon
    g.colCloud[x] = (lon + 180) * 4 - 0.5
  }
}

export function sunCols(g: ShadeTarget, x0: number, x1: number, subsolarLon: number) {
  for (let x = x0; x <= x1; x++) g.colCos[x] = Math.cos((g.colLon[x] - subsolarLon) * RAD)
}

/**
 * Recolour rows ya..yb, columns x0..x1 with the palette ramp, drifting clouds and
 * their shadows, a dithered day/night terminator, city lights, borders, ocean glints
 * and aurora.
 */
export function shadeRows(g: ShadeTarget, f: ShadeFrame, ya: number, yb: number, x0: number, x1: number) {
  const { p, table: tbl, cloud, sinDec, cosDec, t } = f
  const { idx, flags, lights, out, stride, cloudJitter: jit } = g
  const [sr0, sg0, sb0] = p.shade
  const [lr, lg, lb] = p.cityLight
  const [gr, gg, gb] = p.glow
  const [cr0, cg0, cb0] = p.cloud
  const [tr, tg, tb] = p.shadowTint
  const [ar, ag, ab] = p.auroraA
  const [br, bg, bb] = p.auroraB
  const [dr, dg, db] = p.border
  const foamLit = (M.foam * TONES + 2) * 3
  const ns = p.nightStrength
  const ca = f.cloudAlpha
  const tick = (t * 6) | 0
  const oxA = (t * 0.8) | 0
  const oyA = (t * 0.1) | 0
  const oxB = (t * 0.35) | 0

  for (let y = ya; y <= yb; y++) {
    const sr = g.rowSin[y] * sinDec
    const cr = g.rowCos[y] * cosDec
    const lat = g.rowLat[y]
    const alat = Math.abs(lat)
    // Cloud belts: ITCZ and the mid-latitude storm tracks; clear subtropics and poles
    const belt = 0.45 * Math.exp(-((lat / 8) ** 2)) + 0.6 * Math.exp(-(((alat - 55) / 11) ** 2)) + 0.08
    const threshold = 0.64 - belt * 0.2
    const auroraRow = p.aurora > 0.01 && alat > 56 && alat < 78 ? Math.max(0, 1 - Math.abs(alat - 67) / 10) * p.aurora : 0
    const rowF = g.rowCloud[y]
    const row = y * stride

    for (let x = x0; x <= x1; x++) {
      const i = row + x
      const code = idx[i]
      const mat = (code / TONES) | 0
      let k = code * 3
      if (mat <= M.ocean && ((GLINT[i & 65535] + tick) & 127) === 0) k = foamLit
      let r = tbl[k]
      let g_ = tbl[k + 1]
      let b = tbl[k + 2]
      const d = bayer(x, y)

      // Clouds: two scrolling layers of the same tileable noise, in world-grid cells
      const cy = (rowF + (d - 0.5) * jit + 0.5) | 0
      const cx = (g.colCloud[x] + (bayer(y, x) - 0.5) * jit + 0.5) | 0
      const c = cloud[(((cy + oyA) & 255) << 8) | ((cx + oxA) & 255)] * 0.45 + cloud[((((cy >> 1) + 40) & 255) << 8) | (((cx >> 1) + oxB) & 255)] * 0.55
      const cover = c - threshold
      let clouded = false
      if (ca > 0 && cover > (d - 0.5) * 0.04) {
        const a = (cover > 0.05 ? 1 : 0.55) * ca
        r += (cr0 - r) * a
        g_ += (cg0 - g_) * a
        b += (cb0 - b) * a
        clouded = true
      } else if (ca > 0) {
        const sy = cy - 3
        const sx = cx - 3
        const cs = cloud[(((sy + oyA) & 255) << 8) | ((sx + oxA) & 255)] * 0.45 + cloud[((((sy >> 1) + 40) & 255) << 8) | (((sx >> 1) + oxB) & 255)] * 0.55
        if (cs > threshold) {
          const a = 0.28 * ca
          r += (tr - r) * a
          g_ += (tg - g_) * a
          b += (tb - b) * a
        }
      }

      // Day/night with a dithered 4-step terminator
      const cosZ = sr + cr * g.colCos[x]
      let day = (cosZ + 0.1) / 0.16
      day = day < 0 ? 0 : day > 1 ? 1 : day * day * (3 - 2 * day)
      const night = (1 - day) * ns
      const nq = Math.min(1, Math.floor(night * 4 + d) / 4)
      r += (sr0 - r) * nq
      g_ += (sg0 - g_) * nq
      b += (sb0 - b) * nq

      const light = lights[i]
      if (light && day < 0.7) {
        let lk = (1 - day) * (light / 255) * (clouded ? 0.45 : 1)
        if (light > 180) lk *= 0.82 + 0.18 * Math.sin(t * 3 + i)
        const kq = Math.min(1, Math.floor(lk * 3 + d) / 3)
        r += (lr - r) * kq
        g_ += (lg - g_) * kq
        b += (lb - b) * kq
      }

      const fl = flags[i]
      if (fl & (BORDER | ADMIN)) {
        const a = fl & BORDER ? 0.7 : 0.38
        r += (dr - r) * a
        g_ += (dg - g_) * a
        b += (db - b) * a
      }

      if (cosZ > -0.03 && cosZ < -0.008) {
        r += (gr - r) * 0.14
        g_ += (gg - g_) * 0.14
        b += (gb - b) * 0.14
      }

      if (auroraRow > 0 && day < 0.5) {
        const lon = g.colLon[x]
        const wave = 0.5 + 0.5 * Math.sin(lon * 0.12 + t * 0.7 + Math.sin(lon * 0.045 - t * 0.35) * 3)
        const ak = auroraRow * wave * (1 - day * 2)
        if (ak > d * 0.9) {
          const mix = 0.5 + 0.5 * Math.sin(lon * 0.07 - t * 0.4)
          r += (ar + (br - ar) * mix) * 0.35
          g_ += (ag + (bg - ag) * mix) * 0.35
          b += (ab + (bb - ab) * mix) * 0.35
        }
      }

      out[i] = pack(r > 255 ? 255 : r, g_ > 255 ? 255 : g_, b > 255 ? 255 : b)
    }
  }
}
