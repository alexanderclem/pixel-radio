import type { MultiPolygon, Polygon, Position } from 'geojson'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import landUrl from 'world-atlas/land-50m.json?url'

/** Map grid resolution: one cell per quarter degree. */
export const GRID_W = 1440
export const GRID_H = 720
export const CELL_DEG = 360 / GRID_W

export const cellLon = (x: number) => (x + 0.5) * CELL_DEG - 180
export const cellLat = (y: number) => 90 - (y + 0.5) * CELL_DEG
export const lonToCell = (lon: number) => Math.floor((lon + 180) / CELL_DEG)
export const latToCell = (lat: number) => Math.floor((90 - lat) / CELL_DEG)

/**
 * Unwrap longitudes so antimeridian crossings become continuous; rings that circle a
 * pole (Antarctica) are closed along that pole so planar filling works.
 */
function unwrapRing(ring: Position[]): Position[] {
  const out: Position[] = []
  let offset = 0
  let prev = ring[0][0]
  let latSum = 0
  for (const [lon, lat] of ring) {
    const d = lon - prev
    if (d > 180) offset -= 360
    else if (d < -180) offset += 360
    out.push([lon + offset, lat])
    prev = lon
    latSum += lat
  }
  const net = out[out.length - 1][0] - out[0][0]
  if (Math.abs(net) > 180) {
    const pole = latSum / ring.length < 0 ? -90 : 90
    out.push([out[out.length - 1][0], pole], [out[0][0], pole])
  }
  return out
}

/** Fetch Natural Earth 1:50m land and rasterise it into a GRID_W × GRID_H 0/1 mask. */
export async function buildWorldMask(): Promise<Uint8Array> {
  const topo = (await (await fetch(landUrl)).json()) as Topology<{ land: GeometryCollection }>
  const land = feature(topo, topo.objects.land)
  // Runs inside the terrain worker when OffscreenCanvas exists, otherwise on the page
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(GRID_W, GRID_H) : document.createElement('canvas')
  canvas.width = GRID_W
  canvas.height = GRID_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, GRID_W, GRID_H)
  ctx.fillStyle = '#fff'

  const px = (lon: number) => ((lon + 180) / 360) * GRID_W
  const py = (lat: number) => ((90 - lat) / 180) * GRID_H

  for (const f of land.features) {
    const geom = f.geometry as Polygon | MultiPolygon
    const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
    for (const polygon of polygons) {
      const rings = polygon.map(unwrapRing)
      for (const shift of [-360, 0, 360]) {
        ctx.beginPath()
        for (const ring of rings) {
          ring.forEach(([lon, lat], i) => {
            if (i === 0) ctx.moveTo(px(lon + shift), py(lat))
            else ctx.lineTo(px(lon + shift), py(lat))
          })
          ctx.closePath()
        }
        ctx.fill('evenodd')
      }
    }
  }

  const img = ctx.getImageData(0, 0, GRID_W, GRID_H).data
  const mask = new Uint8Array(GRID_W * GRID_H)
  for (let i = 0; i < mask.length; i++) mask[i] = img[i * 4] > 110 ? 1 : 0
  return mask
}
