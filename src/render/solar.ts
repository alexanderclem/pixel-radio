import type { SolarPhase } from '../types'
import { wrapLon } from '../utils/math'

const RAD = Math.PI / 180

export interface SunPosition {
  /** Solar declination, degrees */
  declination: number
  /** Longitude where the sun is directly overhead, degrees */
  subsolarLon: number
}

/** Low-precision solar ephemeris (≈0.1°), plenty for day/night shading. */
export function sunPosition(date: Date): SunPosition {
  const d = date.getTime() / 86400000 - 10957.5 // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD
  const q = 280.459 + 0.98564736 * d
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const e = (23.439 - 0.00000036 * d) * RAD
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD
  const declination = Math.asin(Math.sin(e) * Math.sin(L)) / RAD
  const gmst = 280.46061837 + 360.98564736629 * d
  return { declination, subsolarLon: wrapLon(ra - gmst) }
}

/** Sun elevation above the horizon at a point, degrees. */
export function sunElevation(lat: number, lon: number, sun: SunPosition): number {
  const phi = lat * RAD
  const dec = sun.declination * RAD
  const h = (lon - sun.subsolarLon) * RAD
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h)) / RAD
}

export function classifyPhase(elevation: number, lat: number): SolarPhase {
  if (elevation > 10) return 'day'
  if (elevation > -4) return 'golden'
  return Math.abs(lat) > 55 ? 'aurora' : 'night'
}
