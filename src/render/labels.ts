import { CITIES } from '../constants/cities'
import type { Palette } from '../constants/palettes'
import { geoDistance } from '../utils/geo'
import { rgba, type RGB } from '../utils/math'
import type { Camera } from './camera'

/** [name, lon, lat, population, ISO country], biggest first */
type Place = [string, number, number, number, string]
/** [name, label lon, label lat, Natural Earth min label zoom] */
type Country = [string, number, number, number]

let places: { cities: Place[]; countries: Country[] } | null = null
let loading = false

/** Fetch the place list (a separate chunk) the first time labels are drawn. */
function ensurePlaces() {
  if (loading) return
  loading = true
  import('../data/places.json')
    .then((m) => (places = m.default as unknown as typeof places))
    .catch(() => (loading = false))
}

const CHAR_W = 8
const COUNTRY_MAX_ZOOM = 14

/** Zoom at which a place of this population gets a label. */
export const cityMinZoom = (pop: number) =>
  pop >= 1e7 ? 2.5 : pop >= 3e6 ? 4 : pop >= 1e6 ? 8 : pop >= 3e5 ? 16 : pop >= 1e5 ? 40 : pop >= 2e4 ? 100 : 200

/** Natural Earth's web-map label zoom mapped onto this map's zoom (1 ≈ web zoom 2). */
export const countryMinZoom = (minLabel: number) => 2 ** (minLabel - 2)

export type Rect = [x0: number, y0: number, x1: number, y1: number]

const overlaps = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

/** Greedily keep items in priority order, skipping any whose rect hits one already kept or reserved. */
export function placeLabels<T extends { rect: Rect }>(items: T[], reserved: Rect[]): T[] {
  const taken = [...reserved]
  const kept: T[] = []
  for (const item of items) {
    if (taken.some((r) => overlaps(r, item.rect))) continue
    taken.push(item.rect)
    kept.push(item)
  }
  return kept
}

/** Preset cities already have a tower and name; a place this close with the same name is skipped. */
const isPreset = (name: string, lon: number, lat: number) =>
  CITIES.some((c) => c.name.toLowerCase() === name.toLowerCase() && geoDistance(lon, lat, c.lon, c.lat) < 0.5)

interface Label {
  rect: Rect
  text: string
  x: number
  y: number
  kind: 'country' | 'city'
  major: boolean
}

/**
 * Country names and city names, revealed by population as you zoom and thinned so they
 * never overlap each other or the preset city towers.
 */
export function drawLabels(ctx: CanvasRenderingContext2D, cam: Camera, p: Palette, font: string) {
  ensurePlaces()
  if (!places) return
  const { width: w, height: h, zoom } = cam
  const showPresetNames = zoom >= 1.7
  const reserved: Rect[] = CITIES.map((c) => {
    const [x, y] = cam.geoToScreen(c.lon, c.lat)
    return [x - 5, y - 9, x + (showPresetNames ? 8 + c.name.length * CHAR_W : 5), y + 4]
  })

  // Big cities outrank country names, which outrank smaller towns
  const majorCities: Label[] = []
  const cities: Label[] = []
  for (const [name, lon, lat, pop] of places.cities) {
    if (cityMinZoom(pop) > zoom) break
    const [fx, fy] = cam.geoToScreen(lon, lat)
    if (fx < -8 || fy < -8 || fx > w + 8 || fy > h + 8 || isPreset(name, lon, lat)) continue
    const x = Math.round(fx)
    const y = Math.round(fy)
    const text = name.toUpperCase()
    const label: Label = { rect: [x - 2, y - 5, x + 5 + text.length * CHAR_W, y + 5], text, x, y, kind: 'city', major: pop >= 1e6 }
    ;(label.major ? majorCities : cities).push(label)
  }
  const countries: Label[] = []
  if (zoom <= COUNTRY_MAX_ZOOM) {
    for (const [name, lon, lat, minLabel] of places.countries) {
      if (countryMinZoom(minLabel) > zoom) continue
      const [fx, fy] = cam.geoToScreen(lon, lat)
      const text = name.toUpperCase()
      const half = (text.length * CHAR_W) / 2
      if (fx + half < 0 || fx - half > w || fy < -8 || fy > h + 8) continue
      const x = Math.round(fx - half)
      const y = Math.round(fy - 4)
      countries.push({ rect: [x - 3, y - 3, x + half * 2 + 3, y + 11], text, x, y, kind: 'country', major: true })
    }
  }

  for (const l of placeLabels([...majorCities, ...countries, ...cities], reserved)) {
    if (l.kind === 'country') {
      ctx.drawImage(textSprite(l.text, font, p.border, 0.7, 0.55), l.x, l.y)
      continue
    }
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    ctx.fillRect(l.x - 2, l.y - 2, 4, 4)
    ctx.fillStyle = rgba(p.label)
    ctx.fillRect(l.x - 1, l.y - 1, 2, 2)
    ctx.drawImage(textSprite(l.text, font, p.label, l.major ? 0.95 : 0.75, 0.75), l.x + 4, l.y - 4)
  }
}

const sprites = new Map<string, HTMLCanvasElement>()

/** Text with a 1px drop shadow, rendered once per string and colour instead of every frame. */
function textSprite(text: string, font: string, color: RGB, alpha: number, shadow: number) {
  // Snap the colour so palette crossfades reuse sprites
  const c: RGB = [color[0] & 0xf8, color[1] & 0xf8, color[2] & 0xf8]
  const key = `${text}|${c}|${alpha}`
  let sprite = sprites.get(key)
  if (sprite) return sprite
  sprite = document.createElement('canvas')
  sprite.width = text.length * CHAR_W + 1
  sprite.height = 9
  const g = sprite.getContext('2d')!
  g.font = font
  g.textBaseline = 'top'
  g.fillStyle = `rgba(0,0,0,${shadow})`
  g.fillText(text, 1, 1)
  g.fillStyle = rgba(c, alpha)
  g.fillText(text, 0, 0)
  // Don't keep text drawn in a fallback font while the pixel font is still loading
  if (typeof document.fonts?.check !== 'function' || document.fonts.check(font)) {
    if (sprites.size > 800) sprites.clear()
    sprites.set(key, sprite)
  }
  return sprite
}

/** The labelled place nearest a point, for the HUD ("where am I?"). */
export function nearestPlace(lon: number, lat: number, zoom: number, maxDeg: number): { name: string; country: string } | null {
  ensurePlaces()
  if (!places) return null
  let best: Place | null = null
  let bestD = maxDeg
  for (const place of places.cities) {
    if (cityMinZoom(place[3]) > zoom * 2) break
    const d = geoDistance(lon, lat, place[1], place[2])
    if (d < bestD) {
      bestD = d
      best = place
    }
  }
  return best && { name: best[0], country: best[4] }
}
