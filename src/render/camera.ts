import { clamp, damp } from '../utils/math'

export const MIN_ZOOM = 1
export const MAX_ZOOM = 320
export const CITY_ZOOM = 4

interface View {
  lon: number
  lat: number
  zoom: number
}

/**
 * Equirectangular camera. Zoom 1 fits the whole world to the viewport; the
 * actual view eases toward `target` every frame for smooth glides.
 */
export class Camera {
  lon = 15
  lat = 18
  zoom = 1
  target: View = { lon: 15, lat: 18, zoom: 1 }
  width = 1
  height = 1

  resize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.clampView(this)
    this.clampView(this.target)
  }

  /** Pixels per degree at a given zoom. */
  ppd(zoom = this.zoom) {
    return Math.max(this.width / 360, this.height / 180) * zoom
  }

  update(dt: number) {
    const t = this.target
    this.lon = damp(this.lon, t.lon, 4.5, dt)
    this.lat = damp(this.lat, t.lat, 4.5, dt)
    // Ease zoom in log space so zooming feels uniform
    this.zoom = Math.exp(damp(Math.log(this.zoom), Math.log(t.zoom), 4, dt))
    this.clampView(this)
  }

  geoToScreen(lon: number, lat: number): [number, number] {
    const s = this.ppd()
    return [this.width / 2 + (lon - this.lon) * s, this.height / 2 - (lat - this.lat) * s]
  }

  screenToGeo(x: number, y: number): [number, number] {
    const s = this.ppd()
    return [this.lon + (x - this.width / 2) / s, this.lat - (y - this.height / 2) / s]
  }

  /** Drag pan: moves the target and the view together so the map sticks to the pointer. */
  panBy(dx: number, dy: number) {
    const s = this.ppd()
    this.target.lon -= dx / s
    this.target.lat += dy / s
    this.clampView(this.target)
    this.lon = this.target.lon
    this.lat = this.target.lat
  }

  /** Zoom by `factor` keeping the geo point under (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number) {
    const t = this.target
    const before = this.ppd(t.zoom)
    const geoLon = t.lon + (sx - this.width / 2) / before
    const geoLat = t.lat - (sy - this.height / 2) / before
    t.zoom = clamp(t.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const after = this.ppd(t.zoom)
    t.lon = geoLon - (sx - this.width / 2) / after
    t.lat = geoLat + (sy - this.height / 2) / after
    this.clampView(t)
  }

  flyTo(lon: number, lat: number, zoom: number) {
    this.target = { lon, lat, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) }
    this.clampView(this.target)
  }

  /** Keep the world covering the viewport where possible. */
  private clampView(v: View) {
    v.zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM)
    const s = this.ppd(v.zoom)
    const halfW = this.width / 2 / s
    const halfH = this.height / 2 / s
    v.lon = halfW >= 180 ? 0 : clamp(v.lon, -180 + halfW, 180 - halfW)
    v.lat = halfH >= 90 ? 0 : clamp(v.lat, -90 + halfH, 90 - halfH)
  }
}
