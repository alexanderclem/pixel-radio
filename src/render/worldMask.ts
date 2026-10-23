import type { Position } from 'geojson'

/** Map grid resolution: one cell per quarter degree. */
export const GRID_W = 1440
export const GRID_H = 720
export const CELL_DEG = 360 / GRID_W

export const cellLon = (x: number) => (x + 0.5) * CELL_DEG - 180
export const cellLat = (y: number) => 90 - (y + 0.5) * CELL_DEG
export const lonToCell = (lon: number) => Math.floor((lon + 180) / CELL_DEG)
export const latToCell = (lat: number) => Math.floor((90 - lat) / CELL_DEG)

/** Unwrap longitudes so antimeridian crossings become continuous. */
export function unwrapLine(line: Position[]): Position[] {
  const out: Position[] = []
  let offset = 0
  let prev = line[0][0]
  for (const [lon, lat] of line) {
    const d = lon - prev
    if (d > 180) offset -= 360
    else if (d < -180) offset += 360
    out.push([lon + offset, lat])
    prev = lon
  }
  return out
}

/**
 * Unwrap a ring like a line; rings that circle a pole (Antarctica) are closed along
 * that pole so planar filling works.
 */
export function unwrapRing(ring: Position[]): Position[] {
  const out = unwrapLine(ring)
  const net = out[out.length - 1][0] - out[0][0]
  if (Math.abs(net) > 180) {
    const latSum = ring.reduce((sum, p) => sum + p[1], 0)
    const pole = latSum / ring.length < 0 ? -90 : 90
    out.push([out[out.length - 1][0], pole], [out[0][0], pole])
  }
  return out
}

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Canvas for rasterising; inside the terrain worker it's an OffscreenCanvas. */
export function rasterCanvas(w: number, h: number): Ctx2D {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas.getContext('2d', { willReadFrequently: true }) as Ctx2D
}

/** Fill one polygon's unwrapped rings (even-odd), with lon/lat mapped to pixels by px/py. */
export function fillRings(ctx: Ctx2D, rings: Position[][], px: (lon: number) => number, py: (lat: number) => number) {
  ctx.beginPath()
  for (const ring of rings) {
    ring.forEach(([lon, lat], i) => {
      if (i === 0) ctx.moveTo(px(lon), py(lat))
      else ctx.lineTo(px(lon), py(lat))
    })
    ctx.closePath()
  }
  ctx.fill('evenodd')
}

/** Read a white-on-black raster back as a 0/1 mask. */
export function readMask(ctx: Ctx2D, w: number, h: number): Uint8Array {
  const img = ctx.getImageData(0, 0, w, h).data
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) mask[i] = img[i * 4] > 110 ? 1 : 0
  return mask
}

/** Rasterise land polygons (already unwrapped) into a GRID_W × GRID_H 0/1 mask. */
export function buildWorldMask(polygons: Position[][][]): Uint8Array {
  const ctx = rasterCanvas(GRID_W, GRID_H)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, GRID_W, GRID_H)
  ctx.fillStyle = '#fff'
  const py = (lat: number) => ((90 - lat) / 180) * GRID_H
  for (const rings of polygons) {
    for (const shift of [-360, 0, 360]) fillRings(ctx, rings, (lon) => ((lon + shift + 180) / 360) * GRID_W, py)
  }
  return readMask(ctx, GRID_W, GRID_H)
}
