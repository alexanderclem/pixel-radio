import { CITIES, GLOBAL_AMBIENT } from '../constants/cities'
import type { AmbientMix, CityPreset } from '../types'
import { smoothstep } from './math'

/** Planar distance in degrees on the equirectangular map, wrapping longitude. */
export const geoDistance = (lon1: number, lat1: number, lon2: number, lat2: number) => {
  let dLon = Math.abs(lon1 - lon2)
  if (dLon > 180) dLon = 360 - dLon
  const dLat = lat1 - lat2
  return Math.hypot(dLon * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180)), dLat)
}

export const nearestCity = (lon: number, lat: number): { city: CityPreset; distance: number } => {
  let best = CITIES[0]
  let bestD = Infinity
  for (const c of CITIES) {
    const d = geoDistance(lon, lat, c.lon, c.lat)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return { city: best, distance: bestD }
}

/**
 * Inverse-distance blend of every city's ambient preset around the camera centre.
 * Zoomed out, the mix relaxes toward a neutral planetary bed.
 */
export const computeAmbientMix = (lon: number, lat: number, zoom: number): AmbientMix => {
  const mix: AmbientMix = { rain: 0, wind: 0, city: 0, fire: 0 }
  let total = 0
  for (const c of CITIES) {
    const d = geoDistance(lon, lat, c.lon, c.lat)
    const w = 1 / (d * d + 4)
    total += w
    mix.rain += c.ambient.rain * w
    mix.wind += c.ambient.wind * w
    mix.city += c.ambient.city * w
    mix.fire += c.ambient.fire * w
  }
  const local = smoothstep(1.2, 3.5, zoom)
  for (const k of Object.keys(mix) as (keyof AmbientMix)[]) {
    mix[k] = GLOBAL_AMBIENT[k] + (mix[k] / total - GLOBAL_AMBIENT[k]) * local
  }
  return mix
}
