import { CITIES } from '../constants/cities'
import type { Station } from '../types'
import { geoDistance } from './geo'

const formatters = new Map<string, Intl.DateTimeFormat>()

const format = (timeZone: string, seconds: boolean, date: Date) => {
  const key = `${timeZone}|${seconds}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}),
    })
    formatters.set(key, f)
  }
  return f.format(date)
}

/** IANA zone of a preset city within ~3° of the point, if any. */
export const zoneNear = (lon: number, lat: number): string | null => {
  for (const c of CITIES) if (geoDistance(lon, lat, c.lon, c.lat) < 3) return c.timeZone
  return null
}

/**
 * Wall-clock time where we can name the zone, otherwise local mean solar time
 * (UTC + longitude / 15), prefixed with "~".
 */
export function localTimeAt(lon: number, lat: number, seconds: boolean, date = new Date(), zone = zoneNear(lon, lat)): string {
  if (zone) return format(zone, seconds, date)
  const solar = new Date(date.getTime() + (lon / 15) * 3600000)
  return `~${format('UTC', seconds, solar)}`
}

/** Pseudo FM frequency so every station has a stable spot on the dial. */
export function stationFreq(station: Station): number {
  let h = 0
  for (let i = 0; i < station.id.length; i++) h = (h * 31 + station.id.charCodeAt(i)) >>> 0
  return 88 + (h % 201) / 10
}
