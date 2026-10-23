import { AVATAR_SLOTS, AVATAR_W, composeAvatar, type Avatar } from '../avatar/parts'
import { composeVehicle, vehicleFrames } from '../avatar/vehicles'
import type { TravelMode } from '../avatar/walker'
import { CITIES } from '../constants/cities'
import { buildMaterialTable, TONES, type Palette } from '../constants/palettes'
import type { Station } from '../types'
import { mulberry32, rgba, type RGB } from '../utils/math'
import type { Camera } from './camera'
import type { SunPosition } from './solar'
import { bayer, buildCloudTexture, buildLights, M, type Terrain } from './terrain'
import { cellLat, cellLon, GRID_H, GRID_W } from './worldMask'

const RAD = Math.PI / 180
export const LABEL_FONT = '8px "Press Start 2P", monospace'
const CHAR_W = 8
/** Grid cells shaded per frame; the visible region is refreshed in rolling row bands. */
const CELL_BUDGET = 110_000
/** Screen-space cluster size for station markers (internal px). */
const BIN = 16

/** "((•))" broadcast glyph for a single station. */
const BROADCAST = ['.#...#.', '#..#..#', '#.###.#', '#..#..#', '.#...#.']

/** 3×5 pixel digits for cluster counts. */
const DIGITS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
}

const clusterLabel = (n: number) => (n < 1000 ? String(n) : `${Math.min(9, Math.floor(n / 1000))}K`)
const clusterRadius = (n: number) => (n < 10 ? 4 : n < 100 ? 5 : 6)
/** Badge ink: dark enough to read on every palette's bright station colour. */
const INK = 'rgb(24,16,32)'

export interface HotspotState {
  selectedCityId: string | null
  hoverCityId: string | null
  playing: boolean
  /** Draw markers still: no pulsing rings or blinking */
  calm: boolean
}

export interface StationHit {
  station: Station
  count: number
}

export interface AvatarMark {
  id: string
  name: string
  avatar: Avatar
  /** Your own walker (labelled YOU, not clickable) */
  self: boolean
  stationName: string
  lon: number
  lat: number
  walking: boolean
  mode: TravelMode | 'idle'
  /** 0 on the ground, 1 at cruising height */
  altitude: number
  facing: 1 | -1
}

const FRIEND_COLOR: RGB = [125, 249, 255]

/** Snap a colour to a coarse grid so sprite caching survives palette crossfades. */
const quantize = (c: RGB): RGB => [c[0] & 0xf8, c[1] & 0xf8, c[2] & 0xf8]

const pack = (r: number, g: number, b: number) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)

/** 7×7 radio-tower sprite for the preset cities; 'w' pixels are the blinking signal arcs. */
const TOWER = ['w.....w', '.w.#.w.', 'w.###.w', '...#...', '..#.#..', '..###..', '.#...#.']

/**
 * Pixel world map. Terrain (materials + light/shadow tones) comes precomputed from the
 * worker; each frame recolours the visible part of the quarter-degree grid with the
 * palette ramp, drifting clouds and their shadows, a dithered day/night terminator,
 * station-driven city lights, ocean glints and aurora, then blits it through the camera.
 */
export class MapRenderer {
  private idx: Uint8Array
  private mask: Uint8Array
  private lights: Uint8Array
  private glint: Uint8Array
  private cloud = buildCloudTexture()
  private grid: HTMLCanvasElement
  private gctx: CanvasRenderingContext2D
  private image: ImageData
  private pixels: Uint32Array
  private table: Uint8Array = new Uint8Array(0)
  private tablePalette: Palette | null = null
  private rowSin = new Float32Array(GRID_H)
  private rowCos = new Float32Array(GRID_H)
  private rowLat = new Float32Array(GRID_H)
  private colLon = new Float32Array(GRID_W)
  private colCos = new Float32Array(GRID_W)
  private cursorY = 0
  private firstPass = true

  // Station clustering, rebuilt every frame and reused for hit-testing
  private binCols = 0
  private binRows = 0
  private binCount = new Uint16Array(0)
  private binRep = new Int32Array(0)
  private binList: number[] = []
  private binStations: readonly Station[] = []
  /** Pre-rendered station markers, keyed by colour and label */
  private sprites = new Map<string, HTMLCanvasElement>()

  constructor(terrain: Terrain) {
    this.idx = terrain.idx
    this.mask = terrain.mask
    this.lights = buildLights(this.mask, [])
    const rand = mulberry32(99)
    this.glint = Uint8Array.from({ length: GRID_W * GRID_H }, () => (rand() * 256) | 0)
    this.grid = document.createElement('canvas')
    this.grid.width = GRID_W
    this.grid.height = GRID_H
    this.gctx = this.grid.getContext('2d')!
    this.image = this.gctx.createImageData(GRID_W, GRID_H)
    this.pixels = new Uint32Array(this.image.data.buffer)
    for (let y = 0; y < GRID_H; y++) {
      const lat = cellLat(y)
      this.rowLat[y] = lat
      this.rowSin[y] = Math.sin(lat * RAD)
      this.rowCos[y] = Math.cos(lat * RAD)
    }
    for (let x = 0; x < GRID_W; x++) this.colLon[x] = cellLon(x)
  }

  setLights(points: Iterable<{ lon: number | null; lat: number | null }>) {
    this.lights = buildLights(this.mask, points)
  }

  /** Recolour (part of) the visible grid region. */
  update(p: Palette, sun: SunPosition, t: number, cam: Camera) {
    if (p !== this.tablePalette) {
      this.table = buildMaterialTable(p)
      this.tablePalette = p
    }
    const sinDec = Math.sin(sun.declination * RAD)
    const cosDec = Math.cos(sun.declination * RAD)
    for (let x = 0; x < GRID_W; x++) this.colCos[x] = Math.cos((this.colLon[x] - sun.subsolarLon) * RAD)

    let x0 = 0
    let x1 = GRID_W - 1
    let y0 = 0
    let y1 = GRID_H - 1
    if (!this.firstPass) {
      const s = cam.ppd() / (GRID_W / 360)
      const halfW = cam.width / 2 / s + 2
      const halfH = cam.height / 2 / s + 2
      const cx = (cam.lon + 180) / (360 / GRID_W)
      const cy = (90 - cam.lat) / (360 / GRID_W)
      x0 = Math.max(0, Math.floor(cx - halfW))
      x1 = Math.min(GRID_W - 1, Math.ceil(cx + halfW))
      y0 = Math.max(0, Math.floor(cy - halfH))
      y1 = Math.min(GRID_H - 1, Math.ceil(cy + halfH))
    }
    const width = x1 - x0 + 1
    const rows = this.firstPass ? GRID_H : Math.max(1, Math.min(y1 - y0 + 1, Math.floor(CELL_BUDGET / width)))
    if (this.cursorY < y0 || this.cursorY > y1) this.cursorY = y0

    let start = this.cursorY
    let done = 0
    while (done < rows) {
      const end = Math.min(y1, start + (rows - done) - 1)
      this.shadeRows(start, end, x0, x1, p, sinDec, cosDec, t)
      this.gctx.putImageData(this.image, 0, 0, x0, start, width, end - start + 1)
      done += end - start + 1
      start = end + 1 > y1 ? y0 : end + 1
    }
    this.cursorY = start
    this.firstPass = false
  }

  private shadeRows(ya: number, yb: number, x0: number, x1: number, p: Palette, sinDec: number, cosDec: number, t: number) {
    const tbl = this.table
    const idx = this.idx
    const lights = this.lights
    const glint = this.glint
    const cloud = this.cloud
    const out = this.pixels
    const [sr0, sg0, sb0] = p.shade
    const [lr, lg, lb] = p.cityLight
    const [gr, gg, gb] = p.glow
    const [cr0, cg0, cb0] = p.cloud
    const [tr, tg, tb] = p.shadowTint
    const [ar, ag, ab] = p.auroraA
    const [br, bg, bb] = p.auroraB
    const foamLit = (M.foam * TONES + 2) * 3
    const ns = p.nightStrength
    const ca = p.cloudAlpha
    const tick = (t * 6) | 0
    const oxA = (t * 0.8) | 0
    const oyA = (t * 0.1) | 0
    const oxB = (t * 0.35) | 0

    for (let y = ya; y <= yb; y++) {
      const sr = this.rowSin[y] * sinDec
      const cr = this.rowCos[y] * cosDec
      const lat = this.rowLat[y]
      const alat = Math.abs(lat)
      // Cloud belts: ITCZ and the mid-latitude storm tracks; clear subtropics and poles
      const belt = 0.45 * Math.exp(-((lat / 8) ** 2)) + 0.6 * Math.exp(-(((alat - 55) / 11) ** 2)) + 0.08
      const threshold = 0.64 - belt * 0.2
      const auroraRow = p.aurora > 0.01 && alat > 56 && alat < 78 ? Math.max(0, 1 - Math.abs(alat - 67) / 10) * p.aurora : 0
      const rowA = ((y + oyA) & 255) << 8
      const rowB = (((y >> 1) + 40) & 255) << 8
      const rowAs = ((y - 3 + oyA) & 255) << 8
      const rowBs = ((((y - 3) >> 1) + 40) & 255) << 8
      const row = y * GRID_W

      for (let x = x0; x <= x1; x++) {
        const i = row + x
        const code = idx[i]
        const mat = (code / TONES) | 0
        let k = code * 3
        if (mat <= M.ocean && ((glint[i] + tick) & 127) === 0) k = foamLit
        let r = tbl[k]
        let g = tbl[k + 1]
        let b = tbl[k + 2]
        const d = bayer(x, y)

        // Clouds: two scrolling layers of the same tileable noise
        const c = cloud[rowA | ((x + oxA) & 255)] * 0.45 + cloud[rowB | (((x >> 1) + oxB) & 255)] * 0.55
        const cover = c - threshold
        let clouded = false
        if (cover > (d - 0.5) * 0.04) {
          const a = (cover > 0.05 ? 1 : 0.55) * ca
          r += (cr0 - r) * a
          g += (cg0 - g) * a
          b += (cb0 - b) * a
          clouded = true
        } else {
          const cs = cloud[rowAs | ((x - 3 + oxA) & 255)] * 0.45 + cloud[rowBs | ((((x - 3) >> 1) + oxB) & 255)] * 0.55
          if (cs > threshold) {
            const a = 0.28 * ca
            r += (tr - r) * a
            g += (tg - g) * a
            b += (tb - b) * a
          }
        }

        // Day/night with a dithered 4-step terminator
        const cosZ = sr + cr * this.colCos[x]
        let day = (cosZ + 0.1) / 0.16
        day = day < 0 ? 0 : day > 1 ? 1 : day * day * (3 - 2 * day)
        const night = (1 - day) * ns
        const nq = Math.min(1, Math.floor(night * 4 + d) / 4)
        r += (sr0 - r) * nq
        g += (sg0 - g) * nq
        b += (sb0 - b) * nq

        const light = lights[i]
        if (light && day < 0.7) {
          let lk = (1 - day) * (light / 255) * (clouded ? 0.45 : 1)
          if (light > 180) lk *= 0.82 + 0.18 * Math.sin(t * 3 + i)
          const kq = Math.min(1, Math.floor(lk * 3 + d) / 3)
          r += (lr - r) * kq
          g += (lg - g) * kq
          b += (lb - b) * kq
        }

        if (cosZ > -0.03 && cosZ < -0.008) {
          r += (gr - r) * 0.14
          g += (gg - g) * 0.14
          b += (gb - b) * 0.14
        }

        if (auroraRow > 0 && day < 0.5) {
          const lon = this.colLon[x]
          const wave = 0.5 + 0.5 * Math.sin(lon * 0.12 + t * 0.7 + Math.sin(lon * 0.045 - t * 0.35) * 3)
          const ak = auroraRow * wave * (1 - day * 2)
          if (ak > d * 0.9) {
            const mix = 0.5 + 0.5 * Math.sin(lon * 0.07 - t * 0.4)
            r += (ar + (br - ar) * mix) * 0.35
            g += (ag + (bg - ag) * mix) * 0.35
            b += (ab + (bb - ab) * mix) * 0.35
          }
        }

        out[i] = pack(r > 255 ? 255 : r, g > 255 ? 255 : g, b > 255 ? 255 : b)
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette) {
    const { width: w, height: h } = cam
    ctx.fillStyle = rgba(p.bg)
    ctx.fillRect(0, 0, w, h)
    const s = cam.ppd()
    // Below one screen pixel per cell, average instead of dropping cells
    ctx.imageSmoothingEnabled = s / (GRID_W / 360) < 1
    ctx.imageSmoothingQuality = 'low'
    const [x0, y0] = cam.geoToScreen(-180, 90)
    ctx.drawImage(this.grid, Math.round(x0), Math.round(y0), Math.round(360 * s), Math.round(180 * s))
    ctx.imageSmoothingEnabled = false
    this.drawGraticule(ctx, cam, p)
  }

  private drawGraticule(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette) {
    const { width: w, height: h } = cam
    ctx.fillStyle = rgba(p.grid, 0.13)
    for (let lon = -150; lon <= 150; lon += 30) {
      const [sx] = cam.geoToScreen(lon, 0)
      if (sx < 0 || sx > w) continue
      for (let y = 0; y < h; y += 4) ctx.fillRect(Math.round(sx), y, 1, 1)
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const [, sy] = cam.geoToScreen(0, lat)
      if (sy < 0 || sy > h) continue
      for (let x = 0; x < w; x += 4) ctx.fillRect(x, Math.round(sy), 1, 1)
    }
  }

  /** Cluster stations into BIN×BIN screen cells and draw each cluster as an outlined pixel blob. */
  drawStations(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette, stations: readonly Station[]) {
    const { width: w, height: h } = cam
    const cols = Math.ceil(w / BIN)
    const rows = Math.ceil(h / BIN)
    if (cols * rows !== this.binCount.length) {
      this.binCount = new Uint16Array(cols * rows)
      this.binRep = new Int32Array(cols * rows)
    }
    this.binCols = cols
    this.binRows = rows
    this.binStations = stations
    const count = this.binCount
    const rep = this.binRep
    count.fill(0)
    const list: number[] = []
    const s = cam.ppd()
    const hw = w / 2
    const hh = h / 2
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i]
      const sx = hw + (st.lon! - cam.lon) * s
      const sy = hh - (st.lat! - cam.lat) * s
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
      const bi = ((sy / BIN) | 0) * cols + ((sx / BIN) | 0)
      if (count[bi] === 0) {
        rep[bi] = i
        list.push(bi)
      } else if (st.popularity > stations[rep[bi]].popularity) {
        rep[bi] = i
      }
      if (count[bi] < 65535) count[bi]++
    }
    this.binList = list

    for (const bi of list) {
      const n = count[bi]
      const st = stations[rep[bi]]
      const x = Math.round(hw + (st.lon! - cam.lon) * s)
      const y = Math.round(hh - (st.lat! - cam.lat) * s)
      const sprite = n === 1 ? this.broadcastSprite(p.station) : this.clusterSprite(p.station, p.label, n)
      ctx.drawImage(sprite, x - (sprite.width >> 1), y - (sprite.height >> 1))
    }
  }

  private sprite(key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) {
    let sprite = this.sprites.get(key)
    if (!sprite) {
      // Palette crossfades produce a stream of colours; keep the cache bounded
      if (this.sprites.size > 600) this.sprites.clear()
      sprite = document.createElement('canvas')
      sprite.width = w
      sprite.height = h
      paint(sprite.getContext('2d')!)
      this.sprites.set(key, sprite)
    }
    return sprite
  }

  /** Single station: "((•))" in the station colour with a dark outline. */
  private broadcastSprite(color: RGB) {
    const c = quantize(color)
    return this.sprite(`b${c}`, 9, 7, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.6)'
      BROADCAST.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === '#') g.fillRect(x, y, 3, 3)
      })
      BROADCAST.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== '#') continue
          // Centre mast full strength, arcs a little softer
          g.fillStyle = rgba(c, x >= 2 && x <= 4 ? 1 : 0.8)
          g.fillRect(x + 1, y + 1, 1, 1)
        }
      })
    })
  }

  /** Several stations: a round badge with how many there are. */
  private clusterSprite(color: RGB, highlight: RGB, n: number) {
    const c = quantize(color)
    const label = clusterLabel(n)
    const r = clusterRadius(n)
    const size = r * 2 + 3
    return this.sprite(`c${c}|${label}`, size, size, (g) => {
      const mid = r + 1
      const disc = (radius: number, style: string) => {
        g.fillStyle = style
        for (let dy = -radius; dy <= radius; dy++) {
          const half = Math.floor(Math.sqrt(radius * radius - dy * dy) + 0.5)
          g.fillRect(mid - half, mid + dy, half * 2 + 1, 1)
        }
      }
      disc(r + 1, 'rgba(0,0,0,0.7)')
      disc(r, rgba(c))
      // A glint so it reads as a lit button rather than a flat dot
      g.fillStyle = rgba(highlight, 0.7)
      g.fillRect(mid - (r >> 1) - 1, mid - r + 1, 2, 1)
      const w = label.length * 4 - 1
      let x0 = mid - (w >> 1)
      g.fillStyle = INK
      for (const ch of label) {
        DIGITS[ch].forEach((row, y) => {
          for (let x = 0; x < 3; x++) if (row[x] === '#') g.fillRect(x0 + x, mid - 2 + y, 1, 1)
        })
        x0 += 4
      }
    })
  }

  drawHotspots(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette, t: number, hs: HotspotState) {
    ctx.font = LABEL_FONT
    ctx.textBaseline = 'top'
    const showAll = cam.zoom >= 1.7
    const blinkOn = hs.calm || Math.floor(t * 0.5) % 2 === 0
    CITIES.forEach((city, idx) => {
      const [fx, fy] = cam.geoToScreen(city.lon, city.lat)
      const x = Math.round(fx)
      const y = Math.round(fy)
      if (x < -60 || y < -40 || x > cam.width + 60 || y > cam.height + 40) return
      const selected = city.id === hs.selectedCityId
      const hover = city.id === hs.hoverCityId

      if (!hs.calm) {
        const pulse = (t * 0.4 + idx * 0.37) % 1
        ctx.strokeStyle = rgba(p.glow, (1 - pulse) * 0.4)
        ctx.lineWidth = 1
        const r = Math.round(3 + pulse * 8)
        ctx.strokeRect(x - r + 0.5, y - 3 - r + 0.5, r * 2, r * 2)
      }

      this.drawSprite(ctx, x - 3, y - 6, p.glow, blinkOn || selected ? p.label : null)

      if (selected || hover) {
        this.drawBrackets(ctx, x, y - 3, 9, hs.calm ? 0 : t, selected ? p.label : p.glow)
        this.plate(ctx, cam, x + 9, y - 10, [city.name.toUpperCase(), `${city.freq.toFixed(1)} FM`], p, selected ? p.label : p.glow)
      } else if (showAll) {
        const label = city.name.toUpperCase()
        ctx.fillStyle = 'rgba(0,0,0,0.75)'
        ctx.fillText(label, x + 7, y - 5)
        ctx.fillStyle = rgba(p.glow, 0.9)
        ctx.fillText(label, x + 6, y - 6)
      }
    })
  }

  private drawSprite(ctx: CanvasRenderingContext2D, x: number, y: number, body: RGB, arcs: RGB | null) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    TOWER.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '#' || (row[rx] === 'w' && arcs)) ctx.fillRect(x + rx - 1, y + ry - 1, 3, 3)
      }
    })
    TOWER.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '#') {
          ctx.fillStyle = rgba(body)
          ctx.fillRect(x + rx, y + ry, 1, 1)
        } else if (row[rx] === 'w' && arcs) {
          ctx.fillStyle = rgba(arcs)
          ctx.fillRect(x + rx, y + ry, 1, 1)
        }
      }
    })
  }

  private drawBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, t: number, color: RGB) {
    const b = Math.round(size + Math.sin(t * 2))
    ctx.fillStyle = rgba(color)
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = x + sx * b
      const cy = y + sy * b
      ctx.fillRect(Math.min(cx, cx - sx * 2), cy, 3, 1)
      ctx.fillRect(cx, Math.min(cy, cy - sy * 2), 1, 3)
    }
  }

  /** Pixel-UI tooltip: dark plate, 1px accent border, kept inside the viewport. */
  private plate(ctx: CanvasRenderingContext2D, cam: Camera, x: number, y: number, lines: string[], p: Palette, accent: RGB) {
    const maxChars = Math.max(4, Math.floor((cam.width - 12) / CHAR_W))
    const text = lines.map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l))
    const w = Math.max(...text.map((l) => l.length)) * CHAR_W + 6
    const h = text.length * 10 + 4
    const px = Math.max(2, Math.min(cam.width - w - 2, x))
    const py = Math.max(2, Math.min(cam.height - h - 2, y))
    ctx.fillStyle = 'rgba(0,0,0,0.78)'
    ctx.fillRect(px, py, w, h)
    ctx.fillStyle = rgba(accent)
    ctx.fillRect(px, py, w, 1)
    ctx.fillRect(px, py + h - 1, w, 1)
    ctx.fillRect(px, py, 1, h)
    ctx.fillRect(px + w - 1, py, 1, h)
    ctx.font = LABEL_FONT
    ctx.textBaseline = 'top'
    text.forEach((l, i) => {
      ctx.fillStyle = rgba(i === 0 ? accent : p.label, i === 0 ? 1 : 0.8)
      ctx.fillText(l, px + 3, py + 3 + i * 10)
    })
  }

  /** Marker + broadcast rings for the tuned station, and a tooltip for the hovered cluster. */
  drawStationOverlays(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    p: Palette,
    t: number,
    active: { station: Station; playing: boolean; song: string | null } | null,
    hover: StationHit | null,
    calm = false,
  ) {
    if (active && active.station.lat !== null && active.station.lon !== null) {
      const [fx, fy] = cam.geoToScreen(active.station.lon, active.station.lat)
      const x = Math.round(fx)
      const y = Math.round(fy)
      if (active.playing && calm) {
        ctx.strokeStyle = rgba(p.label, 0.3)
        ctx.beginPath()
        ctx.arc(x + 0.5, y + 0.5, 12, 0, Math.PI * 2)
        ctx.stroke()
      } else if (active.playing) {
        for (let k = 0; k < 3; k++) {
          const ph = (t * 0.4 + k / 3) % 1
          ctx.strokeStyle = rgba(p.label, (1 - ph) * 0.35)
          ctx.beginPath()
          ctx.arc(x + 0.5, y + 0.5, 4 + ph * 26, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.fillStyle = rgba(p.label)
      ctx.fillRect(x - 1, y - 1, 3, 3)
      this.drawBrackets(ctx, x, y, 7, calm ? 0 : t, p.label)
      if (!hover || hover.station.id !== active.station.id) {
        this.plate(ctx, cam, x + 10, y + 6, [active.station.name, active.playing ? (active.song ? `♪ ${active.song}` : 'ON AIR') : 'TUNING…'], p, p.label)
      }
    }
    if (hover && hover.station.lat !== null && hover.station.lon !== null) {
      const [fx, fy] = cam.geoToScreen(hover.station.lon, hover.station.lat)
      const x = Math.round(fx)
      const y = Math.round(fy)
      this.drawBrackets(ctx, x, y, 5, calm ? 0 : t, p.station)
      const s = hover.station
      this.plate(
        ctx,
        cam,
        x + 8,
        y - 26,
        [
          s.name,
          `${s.approx ? '~' : ''}${s.location}`,
          hover.count > 1 ? `+${hover.count - 1} MORE · CLICK TO ZOOM` : `${s.codec}${s.bitrate ? ` ${s.bitrate}K` : ''} · CLICK TO PLAY`,
        ],
        p,
        p.station,
      )
    }
  }

  private avatarSpots: { id: string; x: number; y: number; self: boolean }[] = []

  /** Outlined, optionally mirrored sprite from a colour grid. */
  private outlined(key: string, grid: (string | null)[][], facing: 1 | -1) {
    const w = grid[0].length
    return this.sprite(`${key}|${facing}`, w + 2, grid.length + 2, (g) => {
      const at = (x: number) => (facing === 1 ? x : w - 1 - x)
      g.fillStyle = 'rgba(0,0,0,0.7)'
      grid.forEach((row, y) => row.forEach((c, x) => c && g.fillRect(at(x), y, 3, 3)))
      grid.forEach((row, y) =>
        row.forEach((c, x) => {
          if (!c) return
          g.fillStyle = c
          g.fillRect(at(x) + 1, y + 1, 1, 1)
        }),
      )
    })
  }

  /** The avatar on foot (two-frame step) or riding its boat, plane or balloon. */
  private avatarSprite(avatar: Avatar, mode: AvatarMark['mode'], frame: number, facing: 1 | -1) {
    const look = AVATAR_SLOTS.map((k) => avatar[k]).join('.')
    if (mode === 'boat' || mode === 'plane' || mode === 'balloon') {
      const f = frame % vehicleFrames(mode)
      return this.outlined(`v${mode}${f}|${look}`, composeVehicle(avatar, mode, f), facing)
    }
    const stride = mode === 'walk' && frame % 2 === 1
    return this.outlined(`a${look}|${stride ? 1 : 0}`, composeAvatar(avatar, stride), facing)
  }

  /**
   * Avatars stand just left of their station (station and city plates open to the right);
   * several at one station line up side by side. Walkers use a two-frame step; riders
   * row, fly or drift, with a ground shadow while airborne.
   */
  drawAvatars(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette, t: number, marks: readonly AvatarMark[], hoverId: string | null, calm = false) {
    this.avatarSpots = []
    if (!marks.length) return
    ctx.font = LABEL_FONT
    ctx.textBaseline = 'top'
    const w = AVATAR_W + 2
    // Idle avatars at the same spot share one queue and one name tag
    const groups = new Map<string, { fx: number; fy: number; members: AvatarMark[] }>()
    for (const m of marks) {
      const [fx, fy] = cam.geoToScreen(m.lon, m.lat)
      if (fx < -40 || fy < -60 || fx > cam.width + 40 || fy > cam.height + 40) continue
      const key = m.walking ? m.id : `${Math.round(fx)},${Math.round(fy)}`
      const group = groups.get(key)
      if (group) group.members.push(m)
      else groups.set(key, { fx, fy, members: [m] })
    }

    for (const { fx, fy, members } of groups.values()) {
      // You stand nearest the station
      members.sort((a, b) => Number(b.self) - Number(a.self))
      let top = Infinity
      let left = Infinity
      let right = -Infinity
      members.forEach((m, slot) => {
        const riding = m.mode === 'boat' || m.mode === 'plane' || m.mode === 'balloon'
        const rate = m.mode === 'plane' ? 12 : m.mode === 'walk' ? 6 : 3
        const frame = calm && riding ? 0 : Math.floor(t * rate)
        const sprite = this.avatarSprite(m.avatar, m.mode, frame, m.facing)
        // Riders are centred where a walker's body would be, so boarding doesn't jump sideways
        const cx = Math.round(fx) - 6 - w / 2 - slot * (w - 1)
        const lift = Math.round(m.altitude * 16)
        const bob = m.mode === 'walk' ? frame % 2 : m.mode === 'boat' || m.mode === 'balloon' ? (calm ? 0 : Math.floor(t * 2) % 2) : 0
        const x = Math.round(cx - sprite.width / 2)
        const y = Math.round(fy) + 3 - sprite.height - lift - bob
        if (lift > 2) {
          const r = Math.max(2, 5 - Math.round(m.altitude * 2))
          ctx.fillStyle = 'rgba(0,0,0,0.35)'
          ctx.fillRect(Math.round(cx - r), Math.round(fy) + 2, r * 2, 1)
        }
        ctx.drawImage(sprite, x, y)
        this.avatarSpots.push({ id: m.id, x: x + sprite.width / 2, y: y + sprite.height / 2, self: m.self })
        top = Math.min(top, y)
        left = Math.min(left, x)
        right = Math.max(right, x + sprite.width)
      })

      const hovered = members.find((m) => m.id === hoverId && !m.self)
      if (hovered) {
        this.plate(ctx, cam, right + 2, top - 12, [hovered.name.toUpperCase(), `♪ ${hovered.stationName}`], p, FRIEND_COLOR)
        continue
      }
      const self = members.some((m) => m.self)
      if (!self && cam.zoom < 3) continue
      const names = members.map((m) => (m.self ? 'YOU' : m.name.toUpperCase()))
      const label = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} +${names.length - 1}`
      const lx = Math.round((left + right) / 2 - (label.length * CHAR_W) / 2)
      const ly = top - 10
      ctx.fillStyle = 'rgba(0,0,0,0.75)'
      ctx.fillText(label, lx + 1, ly + 1)
      ctx.fillStyle = self ? rgba(p.label) : rgba(FRIEND_COLOR, 0.95)
      ctx.fillText(label, lx, ly)
    }
  }

  /** The friend avatar under a point (your own avatar isn't a target). */
  hitTestAvatar(x: number, y: number, radius = 8): string | null {
    let best: string | null = null
    let bestD = radius
    for (const spot of this.avatarSpots) {
      if (spot.self) continue
      const d = Math.hypot(spot.x - x, spot.y - y)
      if (d < bestD) {
        bestD = d
        best = spot.id
      }
    }
    return best
  }

  /** Small text HUD, drawn inside the CRT so it gets the same treatment. */
  drawHud(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette, top: string, bottom: string) {
    ctx.font = LABEL_FONT
    ctx.textBaseline = 'top'
    const pad = 6
    const text = (s: string, x: number, y: number) => {
      ctx.fillStyle = 'rgba(0,0,0,0.75)'
      ctx.fillText(s, x + 1, y + 1)
      ctx.fillStyle = rgba(p.label)
      ctx.fillText(s, x, y)
    }
    text(top, pad, pad)
    text(bottom, pad, cam.height - pad - 8)
  }

  hitTestCity(cam: Camera, x: number, y: number, radius = 8): string | null {
    let best: string | null = null
    let bestD = radius
    for (const city of CITIES) {
      const [cx, cy] = cam.geoToScreen(city.lon, city.lat)
      const d = Math.hypot(cx - x, cy - 3 - y)
      if (d < bestD) {
        bestD = d
        best = city.id
      }
    }
    return best
  }

  /** Nearest station cluster to a point, using the bins from the last drawStations(). */
  hitTestStation(cam: Camera, x: number, y: number, radius = 7): StationHit | null {
    const s = cam.ppd()
    let best: StationHit | null = null
    let bestD = radius
    const bx0 = Math.max(0, Math.floor((x - radius) / BIN))
    const bx1 = Math.min(this.binCols - 1, Math.floor((x + radius) / BIN))
    const by0 = Math.max(0, Math.floor((y - radius) / BIN))
    const by1 = Math.min(this.binRows - 1, Math.floor((y + radius) / BIN))
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const bi = by * this.binCols + bx
        const n = this.binCount[bi]
        if (!n) continue
        const st = this.binStations[this.binRep[bi]]
        const sx = cam.width / 2 + (st.lon! - cam.lon) * s
        const sy = cam.height / 2 - (st.lat! - cam.lat) * s
        // Bigger badges are bigger targets
        const d = Math.hypot(sx - x, sy - y) - (n > 1 ? clusterRadius(n) - 3 : 0)
        if (d < bestD) {
          bestD = d
          best = { station: st, count: n }
        }
      }
    }
    return best
  }

  /** Number of visible station clusters drawn last frame. */
  get visibleClusters() {
    return this.binList.length
  }
}
