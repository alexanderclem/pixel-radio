import type { Camera } from './camera'
import { levelFor, LEVELS, tileBounds, tileKey, visibleTiles, type DetailTile } from './detail'
import { initCols, initRows, shadeRows, sunCols, type ShadeFrame, type ShadeTarget } from './shade'

/** Tiles kept in memory (about 0.7 MB each). */
const CACHE = 48
const MAX_INFLIGHT = 2
/** New tiles shaded in full per frame; the rest wait a frame. */
const ARRIVALS_PER_FRAME = 2
const RETRY_MS = 10_000

export interface StationLookup {
  readonly version: number
  within(west: number, south: number, east: number, north: number): Iterable<{ lon: number | null; lat: number | null }>
}

interface Tile {
  key: string
  level: number
  west: number
  north: number
  deg: number
  size: number
  target: ShadeTarget
  /** Built-up glow from the worker, before stations are splatted on */
  urbanLights: Uint8Array
  lightsVersion: number
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  image: ImageData
  cursor: number
}

/**
 * Finer terrain for zoomed-in views: tiles from the terrain worker, shaded with the same
 * palette, clouds and day/night as the world grid and drawn over it. Tiles that haven't
 * arrived yet leave the coarser level showing through.
 */
export class DetailLayer {
  level = 0
  private tiles = new Map<string, Tile>()
  private inflight = new Set<string>()
  private failed = new Map<string, number>()
  private arrived: DetailTile[] = []
  private visible: Tile[] = []
  private missing = false
  private request: (level: number, tx: number, ty: number) => Promise<DetailTile>
  private stations: StationLookup

  constructor(request: (level: number, tx: number, ty: number) => Promise<DetailTile>, stations: StationLookup) {
    this.request = request
    this.stations = stations
  }

  /** True when the current level fully covers the view, so the world grid underneath is hidden. */
  get covering() {
    return this.level > 0 && !this.missing
  }

  /** Fetch, light and recolour the visible tiles; returns how many cells were shaded. */
  update(cam: Camera, f: ShadeFrame, subsolarLon: number, budget: number): number {
    this.level = levelFor(cam.ppd())
    this.visible = []
    this.missing = false
    if (this.level === 0) return 0

    const [west, north] = cam.screenToGeo(0, 0)
    const [east, south] = cam.screenToGeo(cam.width, cam.height)
    const now = performance.now()
    for (const { tx, ty } of visibleTiles(this.level, west, north, east, south)) {
      const key = tileKey(this.level, tx, ty)
      const tile = this.tiles.get(key)
      if (tile) {
        // Map order doubles as recency for eviction
        this.tiles.delete(key)
        this.tiles.set(key, tile)
        this.visible.push(tile)
        continue
      }
      this.missing = true
      if (this.inflight.has(key) || this.inflight.size >= MAX_INFLIGHT || now - (this.failed.get(key) ?? -Infinity) < RETRY_MS) continue
      this.inflight.add(key)
      this.request(this.level, tx, ty)
        .then((t) => this.arrived.push(t))
        .catch(() => this.failed.set(key, performance.now()))
        .finally(() => this.inflight.delete(key))
    }

    let used = 0
    for (const data of this.arrived.splice(0, ARRIVALS_PER_FRAME)) {
      const tile = this.add(data)
      sunCols(tile.target, 0, tile.size - 1, subsolarLon)
      shadeRows(tile.target, f, 0, tile.size - 1, 0, tile.size - 1)
      tile.ctx.putImageData(tile.image, 0, 0)
      used += tile.size * tile.size
    }

    for (const tile of this.visible) {
      if (tile.lightsVersion !== this.stations.version) this.light(tile)
    }

    // Share the remaining budget across visible tiles, rolling through their visible rows
    const share = Math.max(0, budget - used) / Math.max(1, this.visible.length)
    for (const tile of this.visible) {
      const n = tile.size
      const c = tile.deg / n
      const x0 = Math.max(0, Math.floor((west - tile.west) / c))
      const x1 = Math.min(n - 1, Math.ceil((east - tile.west) / c))
      const y0 = Math.max(0, Math.floor((tile.north - north) / c))
      const y1 = Math.min(n - 1, Math.ceil((tile.north - south) / c))
      if (x1 < x0 || y1 < y0) continue
      const width = x1 - x0 + 1
      const rows = Math.max(1, Math.min(y1 - y0 + 1, Math.floor(share / width)))
      sunCols(tile.target, x0, x1, subsolarLon)
      if (tile.cursor < y0 || tile.cursor > y1) tile.cursor = y0
      let start = tile.cursor
      let done = 0
      while (done < rows) {
        const end = Math.min(y1, start + (rows - done) - 1)
        shadeRows(tile.target, f, start, end, x0, x1)
        tile.ctx.putImageData(tile.image, 0, 0, x0, start, width, end - start + 1)
        done += end - start + 1
        start = end + 1 > y1 ? y0 : end + 1
      }
      tile.cursor = start
      used += rows * width
    }
    return used
  }

  private add(data: DetailTile): Tile {
    const n = LEVELS[data.level].size
    const { west, north, deg } = tileBounds(data.level, data.tx, data.ty)
    const canvas = document.createElement('canvas')
    canvas.width = n
    canvas.height = n
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(n, n)
    const f32 = () => new Float32Array(n)
    const target: ShadeTarget = {
      stride: n,
      idx: data.idx,
      flags: data.flags,
      lights: new Uint8Array(n * n),
      out: new Uint32Array(image.data.buffer),
      rowLat: f32(), rowSin: f32(), rowCos: f32(), rowCloud: f32(),
      colLon: f32(), colCloud: f32(), colCos: f32(),
      cloudJitter: 1,
    }
    const c = deg / n
    initRows(target, (y) => north - (y + 0.5) * c)
    initCols(target, (x) => west + (x + 0.5) * c)
    const tile: Tile = {
      key: tileKey(data.level, data.tx, data.ty), level: data.level, west, north, deg, size: n,
      target, urbanLights: data.lights, lightsVersion: -1, canvas, ctx, image, cursor: 0,
    }
    this.light(tile)
    this.tiles.set(tile.key, tile)

    const keep = new Set(this.visible.map((t) => t.key))
    for (const key of this.tiles.keys()) {
      if (this.tiles.size <= CACHE) break
      if (!keep.has(key)) this.tiles.delete(key)
    }
    return tile
  }

  /** Urban glow plus a small halo for every station on the tile. */
  private light(tile: Tile) {
    const n = tile.size
    const c = tile.deg / n
    const lights = tile.target.lights
    lights.set(tile.urbanLights)
    const r = tile.level
    for (const s of this.stations.within(tile.west, tile.north - tile.deg, tile.west + tile.deg, tile.north)) {
      const cx = Math.floor((s.lon! - tile.west) / c)
      const cy = Math.floor((tile.north - s.lat!) / c)
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy
        if (y < 0 || y >= n) continue
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx
          if (x < 0 || x >= n) continue
          const v = 200 * Math.max(0, 1 - Math.hypot(dx, dy) / (r + 1))
          const i = y * n + x
          lights[i] = Math.min(255, lights[i] + v)
        }
      }
    }
    tile.lightsVersion = this.stations.version
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera) {
    if (this.level === 0) return
    // While the current level streams in, show cached coarser tiles in its place
    if (this.missing) {
      const [west, north] = cam.screenToGeo(0, 0)
      const [east, south] = cam.screenToGeo(cam.width, cam.height)
      const coarse = [...this.tiles.values()]
        .filter((t) => t.level < this.level && t.west < east && t.west + t.deg > west && t.north > south && t.north - t.deg < north)
        .sort((a, b) => a.level - b.level)
      for (const t of coarse) this.blit(ctx, cam, t)
    }
    for (const t of this.visible) this.blit(ctx, cam, t)
  }

  private blit(ctx: CanvasRenderingContext2D, cam: Camera, t: Tile) {
    const [x0, y0] = cam.geoToScreen(t.west, t.north)
    const [x1, y1] = cam.geoToScreen(t.west + t.deg, t.north - t.deg)
    const l = Math.round(x0)
    const top = Math.round(y0)
    ctx.drawImage(t.canvas, l, top, Math.round(x1) - l, Math.round(y1) - top)
  }
}
