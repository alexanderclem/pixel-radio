import { slotOnLand, snapToLand, type LandTest } from '../render/landMask'
import type { Station } from '../types'
import { geoDistance } from '../utils/geo'

const bucketKey = (lon: number, lat: number) => {
  const x = ((Math.floor(lon) % 360) + 540) % 360
  const y = Math.min(179, Math.max(0, Math.floor(lat) + 90))
  return y * 360 + x
}

const spotKey = (s: Station) => `${s.lon!.toFixed(3)},${s.lat!.toFixed(3)}`

/** Stations sharing one spot (to ~100 m), by index into `placed`, oldest first. */
interface Spot {
  members: number[]
  /** Spiral slot for each rank, chosen so fanned-out markers stay on land */
  slots: number[]
  /** Next spiral slot to try */
  next: number
}

/** Changes to positions and slots are batched up while land tiles stream in. */
const SETTLE_MS = 250

/** FNV-1a so approximate placement is stable across reloads. */
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * Every station we know a map position for, bucketed by 1° cells for nearest-neighbour
 * lookups. Stations without coordinates are scattered near a geolocated station from the
 * same state (or country), so they still show up where people actually listen. Once the
 * map's coastline is known (setLand), stations whose coordinates fall in the water are
 * moved onto the nearest land, and stacks fan out only onto land.
 */
class StationIndex {
  /** Stations with a map position, in insertion order */
  readonly placed: Station[] = []
  /**
   * For each placed station, its slot on the spiral that stations sharing its spot (to
   * ~100 m) fan out on when zoomed in: 0 for the first, then increasing (see spreadOffset).
   */
  readonly stackRank: number[] = []
  private spots = new Map<string, Spot>()
  private spotOf: string[] = []
  private indexById = new Map<string, number>()
  private byId = new Map<string, Station>()
  private buckets = new Map<number, Station[]>()
  private geoByCountry = new Map<string, Station[]>()
  /** Stations without coordinates from countries with no geolocated station yet */
  private waiting = new Map<string, Map<string, Station>>()
  private land: LandTest | null = null
  /** Placed stations (by index) not yet checked against the coastline */
  private unsettled = new Set<number>()
  /** Spots whose slots wait on land that's still loading */
  private unslotted = new Set<string>()
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  /** Bumped whenever stations are added or move */
  version = 0

  get size() {
    return this.placed.length
  }

  get(id: string) {
    return this.byId.get(id)
  }

  /** A station's slot in the stack at its spot (0 when it's alone or first). */
  rank(id: string) {
    const i = this.indexById.get(id)
    return i === undefined ? 0 : this.stackRank[i]
  }

  /**
   * Use the map's coastline: stations already placed and every one added later are moved
   * out of the water as the land around them loads.
   */
  setLand(land: { isLand: LandTest; onLoad: (() => void) | null }) {
    this.land = land.isLand
    land.onLoad = () => this.scheduleSettle()
    for (let i = 0; i < this.placed.length; i++) this.unsettled.add(i)
    for (const key of this.spots.keys()) this.unslotted.add(key)
    this.scheduleSettle()
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
    const anchored: string[] = []
    const place = (station: Station) => {
      if (this.byId.has(station.id)) return
      const s = station.lat === null ? this.placeApprox(station) : station
      if (!s) {
        // Held until the first geolocated station from its country arrives
        if (!station.country) return
        const queue = this.waiting.get(station.country)
        if (queue) queue.set(station.id, station)
        else this.waiting.set(station.country, new Map([[station.id, station]]))
        return
      }
      const i = this.placed.length
      this.byId.set(s.id, s)
      this.indexById.set(s.id, i)
      this.placed.push(s)
      this.stackRank.push(0)
      this.join(i)
      this.bucket(s).push(s)
      if (this.land) this.unsettled.add(i)
      if (!s.approx && s.country) {
        const geo = this.geoByCountry.get(s.country)
        if (geo) geo.push(s)
        else {
          this.geoByCountry.set(s.country, [s])
          anchored.push(s.country)
        }
      }
      added++
    }
    for (const station of list) place(station)
    for (const country of anchored) {
      const queue = this.waiting.get(country)
      this.waiting.delete(country)
      if (queue) for (const station of queue.values()) place(station)
    }
    if (added) {
      this.version++
      if (this.land) this.scheduleSettle()
    }
    return added
  }

  private bucket(s: Station) {
    const key = bucketKey(s.lon!, s.lat!)
    let bucket = this.buckets.get(key)
    if (!bucket) this.buckets.set(key, (bucket = []))
    return bucket
  }

  private join(i: number) {
    const key = spotKey(this.placed[i])
    let spot = this.spots.get(key)
    if (!spot) this.spots.set(key, (spot = { members: [], slots: [0], next: 1 }))
    spot.members.push(i)
    this.spotOf[i] = key
    this.restack(key)
  }

  private leave(i: number) {
    const key = this.spotOf[i]
    const spot = this.spots.get(key)!
    spot.members.splice(spot.members.indexOf(i), 1)
    if (spot.members.length) this.restack(key)
    else {
      this.spots.delete(key)
      this.unslotted.delete(key)
    }
  }

  /** Give each station at a spot its slot; returns whether any changed. */
  private restack(key: string) {
    const spot = this.spots.get(key)!
    const { members, slots } = spot
    if (this.land && slots.length < members.length) {
      const first = this.placed[members[0]]
      const centre = this.land(first.lon!, first.lat!)
      // Give up on land after a while (a tiny island), so a big stack still gets every slot
      const limit = members.length * 6 + 40
      while (slots.length < members.length) {
        // A stack out at sea fans out wherever it likes
        const ok = centre === false || spot.next > limit ? true : centre === null ? null : slotOnLand(this.land, first.lon!, first.lat!, spot.next)
        if (ok === null) {
          this.unslotted.add(key)
          break
        }
        if (ok) slots.push(spot.next)
        spot.next++
      }
    }
    let changed = false
    members.forEach((i, rank) => {
      // Until the land loads, the plain spiral
      const slot = this.land ? (slots[rank] ?? rank) : rank
      if (this.stackRank[i] !== slot) {
        this.stackRank[i] = slot
        changed = true
      }
    })
    return changed
  }

  private scheduleSettle() {
    this.settleTimer ??= setTimeout(() => {
      this.settleTimer = null
      this.settle()
    }, SETTLE_MS)
  }

  /** Move stations whose land has loaded out of the water, and fan out stacks onto land. */
  private settle() {
    const land = this.land
    if (!land) return
    let changed = false
    for (const i of this.unsettled) {
      const s = this.placed[i]
      const to = snapToLand(land, s.lon!, s.lat!)
      if (!to) continue
      this.unsettled.delete(i)
      if (to[0] === s.lon && to[1] === s.lat) continue
      const bucket = this.bucket(s)
      bucket.splice(bucket.indexOf(s), 1)
      this.leave(i)
      s.lon = to[0]
      s.lat = to[1]
      this.bucket(s).push(s)
      this.join(i)
      changed = true
    }
    // Restacking re-queues a spot whose land is still loading
    const pending = [...this.unslotted]
    this.unslotted.clear()
    for (const key of pending) if (this.restack(key)) changed = true
    if (changed) this.version++
  }

  private placeApprox(s: Station): Station | null {
    const geo = this.geoByCountry.get(s.country)
    if (!geo?.length) return null
    const sameState = s.state ? geo.filter((g) => g.state === s.state) : []
    const pool = sameState.length ? sameState : geo
    const h = hash(s.id)
    const anchor = pool[h % pool.length]
    // Round on the map, and close enough to the anchor that land is always in snapping range
    const jitter = (bits: number) => ((bits & 1023) / 1023 - 0.5) * 0.24
    const lat = anchor.lat! + jitter(h >>> 10)
    const lon = anchor.lon! + jitter(h >>> 20)
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
