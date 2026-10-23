import type { Station } from '../types'
import { geoDistance } from '../utils/geo'

const bucketKey = (lon: number, lat: number) => {
  const x = ((Math.floor(lon) % 360) + 540) % 360
  const y = Math.min(179, Math.max(0, Math.floor(lat) + 90))
  return y * 360 + x
}

/** FNV-1a so approximate placement is stable across reloads. */
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Every station we know a map position for, bucketed by 1° cells for nearest-neighbour
 * lookups. Stations without coordinates are scattered near a geolocated station from the
 * same state (or country), so they still show up where people actually listen.
 */
class StationIndex {
  /** Stations with a map position, in insertion order */
  readonly placed: Station[] = []
  /**
   * For each placed station, how many placed before it share its spot (to ~100 m).
   * Stacked stations fan out around that spot when zoomed in.
   */
  readonly stackRank: number[] = []
  private stacks = new Map<string, number>()
  private rankById = new Map<string, number>()
  private byId = new Map<string, Station>()
  private buckets = new Map<number, Station[]>()
  private geoByCountry = new Map<string, Station[]>()
  /** Bumped whenever stations are added */
  version = 0

  get size() {
    return this.placed.length
  }

  get(id: string) {
    return this.byId.get(id)
  }

  /** A station's place in the stack at its spot (0 when it's alone or first). */
  rank(id: string) {
    return this.rankById.get(id) ?? 0
  }

  /** Stations inside a lon/lat box (no antimeridian wrap). */
  within(west: number, south: number, east: number, north: number): Station[] {
    const out: Station[] = []
    for (let y = Math.floor(south); y <= Math.floor(north); y++) {
      if (y < -90 || y >= 90) continue
      for (let x = Math.floor(west); x <= Math.floor(east); x++) {
        const bucket = this.buckets.get(bucketKey(x, y))
        if (!bucket) continue
        for (const s of bucket) if (s.lon! >= west && s.lon! < east && s.lat! >= south && s.lat! < north) out.push(s)
      }
    }
    return out
  }

  /** Returns how many stations were newly placed on the map. */
  add(list: Station[]): number {
    let added = 0
    for (const station of list) {
      if (this.byId.has(station.id)) continue
      const s = station.lat === null ? this.placeApprox(station) : station
      if (!s) continue
      this.byId.set(s.id, s)
      this.placed.push(s)
      const spot = `${s.lon!.toFixed(3)},${s.lat!.toFixed(3)}`
      const rank = this.stacks.get(spot) ?? 0
      this.stacks.set(spot, rank + 1)
      this.stackRank.push(rank)
      this.rankById.set(s.id, rank)
      const key = bucketKey(s.lon!, s.lat!)
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(s)
      else this.buckets.set(key, [s])
      if (!s.approx && s.country) {
        const geo = this.geoByCountry.get(s.country)
        if (geo) geo.push(s)
        else this.geoByCountry.set(s.country, [s])
      }
      added++
    }
    if (added) this.version++
    return added
  }

  private placeApprox(s: Station): Station | null {
    const geo = this.geoByCountry.get(s.country)
    if (!geo?.length) return null
    const sameState = s.state ? geo.filter((g) => g.state === s.state) : []
    const pool = sameState.length ? sameState : geo
    const h = hash(s.id)
    const anchor = pool[h % pool.length]
    const jitter = (bits: number) => ((bits & 1023) / 1023 - 0.5) * 0.35
    const lat = anchor.lat! + jitter(h >>> 10)
    const lon = anchor.lon! + jitter(h >>> 20) / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
    return { ...s, lat, lon, approx: true }
  }

  /** Up to `n` closest stations to a point, nearest first. */
  nearest(lon: number, lat: number, n: number, excludeId?: string): Station[] {
    const found: Station[] = []
    const cx = Math.floor(lon)
    const cy = Math.floor(lat)
    for (let r = 0; r <= 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const y = cy + dy
          if (y < -90 || y >= 90) continue
          const bucket = this.buckets.get(bucketKey(cx + dx, y))
          if (bucket) for (const s of bucket) if (s.id !== excludeId) found.push(s)
        }
      }
      // One extra ring past the first full set keeps results correct at cell borders
      if (found.length >= n && r >= 1 && (found.length >= n * 3 || r >= 3)) break
    }
    return found
      .map((s) => ({ s, d: geoDistance(lon, lat, s.lon!, s.lat!) }))
      .sort((a, b) => a.d - b.d || b.s.popularity - a.s.popularity)
      .slice(0, n)
      .map((x) => x.s)
  }
}

export const stationIndex = new StationIndex()
