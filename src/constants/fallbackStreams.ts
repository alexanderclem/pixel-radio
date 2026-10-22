import type { Station } from '../types'

const curated = (id: string, name: string, path: string): Station => ({
  id, name, url: `https://stream.radioparadise.com/${path}`, hls: false, codec: 'AAC', bitrate: 128,
  country: 'US', state: 'California', location: 'Paradise, California', homepage: 'https://radioparadise.com',
  tags: 'eclectic', popularity: 0, lat: null, lon: null, approx: false, source: 'curated',
})

/** Curated HTTPS streams that send CORS headers, so they can be analysed and filtered. */
export const FALLBACK_STATIONS: Station[] = [
  curated('rp-main', 'Radio Paradise · Main Mix', 'aac-128'),
  curated('rp-mellow', 'Radio Paradise · Mellow', 'mellow-128'),
  curated('rp-world', 'Radio Paradise · World/Etc', 'world-etc-128'),
]
