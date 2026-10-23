import { AVATAR_H, AVATAR_SLOTS, AVATAR_W, composeAvatar, type Avatar } from '../avatar/parts'
import { CITIES } from '../constants/cities'
import { buildMaterialTable, type Palette } from '../constants/palettes'
import type { Station } from '../types'
import { rgba, smoothstep, type RGB } from '../utils/math'
import type { Camera } from './camera'
import type { DetailTile } from './detail'
import { DetailLayer, type StationLookup } from './detailLayer'
import { drawLabels } from './labels'
import { initCols, initRows, shadeRows, sunCols, type ShadeFrame, type ShadeTarget } from './shade'
import type { SunPosition } from './solar'
import { spreadAt, spreadOffset } from './stack'
import { buildCloudTexture, buildLights, type Terrain } from './terrain'
import { cellLat, cellLon, GRID_H, GRID_W } from './worldMask'

const RAD = Math.PI / 180
export const LABEL_FONT = '8px "Press Start 2P", monospace'
const CHAR_W = 8
/** Grid cells shaded per frame; the visible region is refreshed in rolling row bands. */
const CELL_BUDGET = 110_000
/** Detail tiles change slowly (drifting clouds, the terminator), so they refresh at a gentler pace. */
const DETAIL_BUDGET = 45_000
/** Screen-space cluster size for station markers (internal px); smaller once stacks fan out. */
const BIN = 16
const BIN_NEAR = 11
/** Floats stored per cluster bin, see binGeo */
const GEO = 8

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
  /** The cluster's most popular station */
  station: Station
  /** That station's place in its stack (see stationIndex.stackRank) */
  rank: number
  count: number
  /** Centre and size (degrees) of the cluster's members */
  lon: number
  lat: number
  span: number
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
  /** The station's place in its stack, so idle avatars stand by its fanned-out marker */
  rank: number
  walking: boolean
  facing: 1 | -1
}

const FRIEND_COLOR: RGB = [125, 249, 255]

/** Snap a colour to a coarse grid so sprite caching survives palette crossfades. */
const quantize = (c: RGB): RGB => [c[0] & 0xf8, c[1] & 0xf8, c[2] & 0xf8]

/** Where a station's marker sits on screen, including its fan-out from a shared spot. */
export function stationScreen(cam: Camera, lon: number, lat: number, rank: number): [number, number] {
  const [fx, fy] = cam.geoToScreen(lon, lat)
  const [ox, oy] = spreadOffset(rank, spreadAt(cam.zoom))
  return [Math.round(fx) + ox, Math.round(fy) + oy]
}

/** 7×7 radio-tower sprite for the preset cities; 'w' pixels are the blinking signal arcs. */
const TOWER = ['w.....w', '.w.#.w.', 'w.###.w', '...#...', '..#.#..', '..###..', '.#...#.']

/**
 * Pixel world map. Terrain (materials + light/shadow tones) comes precomputed from the
 * worker; each frame recolours the visible part of the quarter-degree grid with the
 * palette ramp, drifting clouds and their shadows, a dithered day/night terminator,
 * station-driven city lights, ocean glints and aurora, then blits it through the camera.
 * Zoomed in, finer detail tiles are shaded the same way and drawn over it.
 */
export class MapRenderer {
  private base: ShadeTarget
  private mask: Uint8Array
  private cloud = buildCloudTexture()
  private grid: HTMLCanvasElement
  private gctx: CanvasRenderingContext2D
  private image: ImageData
  private table: Uint8Array = new Uint8Array(0)
  private tablePalette: Palette | null = null
  private detail: DetailLayer
  private cursorY = 0
  private firstPass = true

  // Station clustering, rebuilt every frame and reused for hit-testing
  private binSize = BIN
  private binCols = 0
  private binRows = 0
  private binCount = new Uint16Array(0)
  private binRep = new Int32Array(0)
  /** Per bin: rep marker x/y on screen, then the members' lon/lat sums and box */
  private binGeo = new Float64Array(0)
  private binList: number[] = []
  private binStations: readonly Station[] = []
  private binRanks: readonly number[] = []
  /** Pre-rendered station markers, keyed by colour and label */
  private sprites = new Map<string, HTMLCanvasElement>()

  constructor(terrain: Terrain, tiles: (level: number, tx: number, ty: number) => Promise<DetailTile>, stations: StationLookup) {
    this.mask = terrain.mask
    this.grid = document.createElement('canvas')
    this.grid.width = GRID_W
    this.grid.height = GRID_H
    this.gctx = this.grid.getContext('2d')!
    this.image = this.gctx.createImageData(GRID_W, GRID_H)
    const rows = () => new Float32Array(GRID_H)
    const cols = () => new Float32Array(GRID_W)
    this.base = {
      stride: GRID_W,
      idx: terrain.idx,
      flags: terrain.flags,
      lights: buildLights(this.mask, []),
      out: new Uint32Array(this.image.data.buffer),
      rowLat: rows(), rowSin: rows(), rowCos: rows(), rowCloud: rows(),
      colLon: cols(), colCloud: cols(), colCos: cols(),
      cloudJitter: 0,
    }
    initRows(this.base, cellLat)
    initCols(this.base, cellLon)
    this.detail = new DetailLayer(tiles, stations)
  }

  setLights(points: Iterable<{ lon: number | null; lat: number | null }>) {
    this.base.lights = buildLights(this.mask, points)
  }

  /** Recolour (part of) the visible grid region and any detail tiles in view. */
  update(p: Palette, sun: SunPosition, t: number, cam: Camera) {
    if (p !== this.tablePalette) {
      this.table = buildMaterialTable(p)
      this.tablePalette = p
    }
    const frame: ShadeFrame = {
      p, t,
      table: this.table,
      cloud: this.cloud,
      sinDec: Math.sin(sun.declination * RAD),
      cosDec: Math.cos(sun.declination * RAD),
      // Thin the clouds out as you dive in so the ground stays readable
      cloudAlpha: p.cloudAlpha * (1 - 0.85 * smoothstep(8, 40, cam.zoom)),
    }

    const used = this.detail.update(cam, frame, sun.subsolarLon, DETAIL_BUDGET)
    // Under fully loaded detail tiles the world grid only needs an occasional refresh
    const budget = this.firstPass ? Infinity : this.detail.covering ? 4_000 : Math.max(20_000, CELL_BUDGET - used)

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
    sunCols(this.base, x0, x1, sun.subsolarLon)
    const width = x1 - x0 + 1
    const rows = this.firstPass ? GRID_H : Math.max(1, Math.min(y1 - y0 + 1, Math.floor(budget / width)))
    if (this.cursorY < y0 || this.cursorY > y1) this.cursorY = y0

    let start = this.cursorY
    let done = 0
    while (done < rows) {
      const end = Math.min(y1, start + (rows - done) - 1)
      shadeRows(this.base, frame, start, end, x0, x1)
      this.gctx.putImageData(this.image, 0, 0, x0, start, width, end - start + 1)
      done += end - start + 1
      start = end + 1 > y1 ? y0 : end + 1
    }
    this.cursorY = start
    this.firstPass = false
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
    this.detail.draw(ctx, cam)
    this.drawGraticule(ctx, cam, p)
  }

  /** Country and city names. */
  drawLabels(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette) {
    drawLabels(ctx, cam, p, LABEL_FONT)
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

  /**
   * Cluster stations into screen bins and draw each cluster as an outlined pixel blob.
   * Zoomed in, stations sharing one spot fan out (by `ranks`) so each gets its own marker.
   */
  drawStations(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette, stations: readonly Station[], ranks: readonly number[]) {
    const { width: w, height: h } = cam
    const bin = cam.zoom >= 30 ? BIN_NEAR : BIN
    const cols = Math.ceil(w / bin)
    const rows = Math.ceil(h / bin)
    if (cols * rows !== this.binCount.length) {
      this.binCount = new Uint16Array(cols * rows)
      this.binRep = new Int32Array(cols * rows)
      this.binGeo = new Float64Array(cols * rows * GEO)
    }
    this.binSize = bin
    this.binCols = cols
    this.binRows = rows
    this.binStations = stations
    this.binRanks = ranks
    const count = this.binCount
    const rep = this.binRep
    const geo = this.binGeo
    count.fill(0)
    const list: number[] = []
    const s = cam.ppd()
    const hw = w / 2
    const hh = h / 2
    const spread = spreadAt(cam.zoom)
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i]
      const lon = st.lon!
      const lat = st.lat!
      let sx = hw + (lon - cam.lon) * s
      let sy = hh - (lat - cam.lat) * s
      if (spread > 0 && ranks[i] > 0) {
        const [ox, oy] = spreadOffset(ranks[i], spread)
        sx += ox
        sy += oy
      }
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
      const bi = ((sy / bin) | 0) * cols + ((sx / bin) | 0)
      const g = bi * GEO
      if (count[bi] === 0) {
        rep[bi] = i
        list.push(bi)
        geo.set([sx, sy, lon, lat, lon, lat, lon, lat], g)
      } else {
        if (st.popularity > stations[rep[bi]].popularity) {
          rep[bi] = i
          geo[g] = sx
          geo[g + 1] = sy
        }
        geo[g + 2] += lon
        geo[g + 3] += lat
        geo[g + 4] = Math.min(geo[g + 4], lon)
        geo[g + 5] = Math.min(geo[g + 5], lat)
        geo[g + 6] = Math.max(geo[g + 6], lon)
        geo[g + 7] = Math.max(geo[g + 7], lat)
      }
      if (count[bi] < 65535) count[bi]++
    }
    this.binList = list

    for (const bi of list) {
      const n = count[bi]
      const x = Math.round(geo[bi * GEO])
      const y = Math.round(geo[bi * GEO + 1])
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
    active: { station: Station; rank: number; playing: boolean; song: string | null } | null,
    hover: StationHit | null,
    calm = false,
  ) {
    if (active && active.station.lat !== null && active.station.lon !== null) {
      const [x, y] = stationScreen(cam, active.station.lon, active.station.lat, active.rank)
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
      const [x, y] = stationScreen(cam, hover.station.lon, hover.station.lat, hover.rank)
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

  /** Outlined, optionally mirrored avatar sprite for one walk frame. */
  private avatarSprite(avatar: Avatar, stride: boolean, facing: 1 | -1) {
    const key = `a${AVATAR_SLOTS.map((k) => avatar[k]).join('.')}|${stride ? 1 : 0}|${facing}`
    return this.sprite(key, AVATAR_W + 2, AVATAR_H + 2, (g) => {
      const grid = composeAvatar(avatar, stride)
      const at = (x: number) => (facing === 1 ? x : AVATAR_W - 1 - x)
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

  /**
   * Avatars stand just left of their station (station and city plates open to the right);
   * several at one station line up side by side. Walkers use a two-frame step.
   */
  drawAvatars(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette, t: number, marks: readonly AvatarMark[], hoverId: string | null) {
    this.avatarSpots = []
    if (!marks.length) return
    ctx.font = LABEL_FONT
    ctx.textBaseline = 'top'
    const w = AVATAR_W + 2
    const h = AVATAR_H + 2
    // Idle avatars at the same spot share one queue and one name tag
    const groups = new Map<string, { fx: number; fy: number; members: AvatarMark[] }>()
    for (const m of marks) {
      const [fx, fy] = m.walking ? cam.geoToScreen(m.lon, m.lat) : stationScreen(cam, m.lon, m.lat, m.rank)
      if (fx < -40 || fy < -40 || fx > cam.width + 40 || fy > cam.height + 40) continue
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
        const stride = m.walking && Math.floor(t * 6) % 2 === 1
        const x = Math.round(fx) - 6 - w - slot * (w - 1)
        const y = Math.round(fy) + 3 - h - (stride ? 1 : 0)
        ctx.drawImage(this.avatarSprite(m.avatar, stride, m.facing), x, y)
        this.avatarSpots.push({ id: m.id, x: x + w / 2, y: y + h / 2, self: m.self })
        top = Math.min(top, y)
        left = Math.min(left, x)
        right = Math.max(right, x + w)
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
  hitTestStation(x: number, y: number, radius = 7): StationHit | null {
    const bin = this.binSize
    let best: StationHit | null = null
    let bestD = radius
    const bx0 = Math.max(0, Math.floor((x - radius) / bin))
    const bx1 = Math.min(this.binCols - 1, Math.floor((x + radius) / bin))
    const by0 = Math.max(0, Math.floor((y - radius) / bin))
    const by1 = Math.min(this.binRows - 1, Math.floor((y + radius) / bin))
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const bi = by * this.binCols + bx
        const n = this.binCount[bi]
        if (!n) continue
        const g = bi * GEO
        const geo = this.binGeo
        // Bigger badges are bigger targets
        const d = Math.hypot(geo[g] - x, geo[g + 1] - y) - (n > 1 ? clusterRadius(n) - 3 : 0)
        if (d < bestD) {
          bestD = d
          const rep = this.binRep[bi]
          best = {
            station: this.binStations[rep],
            rank: this.binRanks[rep] ?? 0,
            count: n,
            lon: geo[g + 2] / n,
            lat: geo[g + 3] / n,
            span: Math.max(geo[g + 6] - geo[g + 4], geo[g + 7] - geo[g + 5]),
          }
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
