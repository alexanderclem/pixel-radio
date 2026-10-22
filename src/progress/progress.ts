/**
 * Listening and focus progress, kept on this device: focus minutes per day (and how many
 * of them were with friends), and a passport of stations and countries heard.
 */

export interface DayLog {
  /** Focus minutes completed */
  minutes: number
  /** Of those, minutes focused with friends (a room, or a friend focusing at the same time) */
  together: number
}

export interface StampedStation {
  name: string
  country: string
  location: string
  lat: number | null
  lon: number | null
  firstAt: number
  minutes: number
}

export interface Progress {
  days: Record<string, DayLog>
  countries: Record<string, { firstAt: number; minutes: number }>
  stations: Record<string, StampedStation>
  /** Avatar parts already celebrated, so each unlock is announced once */
  celebrated: string[]
}

export const EMPTY_PROGRESS: Progress = { days: {}, countries: {}, stations: {}, celebrated: [] }

const KEEP_DAYS = 400
export const MAX_STAMPED_STATIONS = 500
/** Continuous listening before a station earns its stamp */
export const STAMP_AFTER_MS = 2 * 60_000

export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const shiftDay = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

/** Add a finished focus session to today's log; old days roll off. */
export function recordFocus(p: Progress, minutes: number, together: boolean, now = new Date()): Progress {
  const key = dayKey(now)
  const today = p.days[key] ?? { minutes: 0, together: 0 }
  const days = { ...p.days, [key]: { minutes: today.minutes + minutes, together: today.together + (together ? minutes : 0) } }
  const cutoff = dayKey(shiftDay(now, -KEEP_DAYS))
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k]
  return { ...p, days }
}

/** Days in a row with at least one finished focus session, ending today or yesterday. */
export function streak(p: Progress, now = new Date()): number {
  let day = p.days[dayKey(now)]?.minutes ? now : shiftDay(now, -1)
  let count = 0
  while (p.days[dayKey(day)]?.minutes) {
    count++
    day = shiftDay(day, -1)
  }
  return count
}

/** Focus minutes over the last seven days (today included). */
export function week(p: Progress, now = new Date()) {
  let minutes = 0
  let together = 0
  for (let i = 0; i < 7; i++) {
    const d = p.days[dayKey(shiftDay(now, -i))]
    minutes += d?.minutes ?? 0
    together += d?.together ?? 0
  }
  return { minutes, together }
}

export interface Totals {
  focusHours: number
  togetherHours: number
  streak: number
  countries: number
  stations: number
  listenedHours: number
}

export function totals(p: Progress, now = new Date()): Totals {
  const days = Object.values(p.days)
  return {
    focusHours: days.reduce((n, d) => n + d.minutes, 0) / 60,
    togetherHours: days.reduce((n, d) => n + d.together, 0) / 60,
    streak: streak(p, now),
    countries: Object.keys(p.countries).length,
    stations: Object.keys(p.stations).length,
    listenedHours: Object.values(p.stations).reduce((n, s) => n + s.minutes, 0) / 60,
  }
}

/** "4h 20m", "35m". */
export const hm = (minutes: number) => {
  const m = Math.round(minutes)
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`
}

interface Listened {
  id: string
  name: string
  country: string
  location: string
  lat: number | null
  lon: number | null
}

/**
 * Credit listening time to a station (and its country). Returns the progress and whether
 * this earned a new stamp. `heardMs` is continuous time on this station so far.
 */
export function creditListening(p: Progress, st: Listened, addMs: number, heardMs: number, now: number): { progress: Progress; stamped: 'station' | 'country' | null } {
  const known = p.stations[st.id]
  if (!known && heardMs < STAMP_AFTER_MS) return { progress: p, stamped: null }
  const minutes = addMs / 60_000
  const stations = {
    ...p.stations,
    [st.id]: known
      ? { ...known, minutes: known.minutes + minutes }
      : { name: st.name, country: st.country, location: st.location, lat: st.lat, lon: st.lon, firstAt: now, minutes: heardMs / 60_000 },
  }
  // Keep the most-listened stations when the passport is full
  const ids = Object.keys(stations)
  if (ids.length > MAX_STAMPED_STATIONS) {
    const least = ids.filter((id) => id !== st.id).sort((a, b) => stations[a].minutes - stations[b].minutes)[0]
    delete stations[least]
  }
  let countries = p.countries
  let stamped: 'station' | 'country' | null = known ? null : 'station'
  if (/^[A-Z]{2}$/.test(st.country)) {
    const c = p.countries[st.country]
    countries = { ...p.countries, [st.country]: c ? { ...c, minutes: c.minutes + (known ? minutes : heardMs / 60_000) } : { firstAt: now, minutes: heardMs / 60_000 } }
    if (!c) stamped = 'country'
  }
  return { progress: { ...p, stations, countries }, stamped }
}

/** Read progress back from storage, dropping anything malformed. */
export function sanitizeProgress(v: unknown): Progress {
  if (typeof v !== 'object' || v === null) return EMPTY_PROGRESS
  const raw = v as Record<string, unknown>
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
  const obj = (x: unknown): Record<string, unknown> => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {})
  const days: Progress['days'] = {}
  for (const [k, d] of Object.entries(obj(raw.days))) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) days[k] = { minutes: num(obj(d).minutes), together: num(obj(d).together) }
  }
  const countries: Progress['countries'] = {}
  for (const [k, c] of Object.entries(obj(raw.countries))) if (/^[A-Z]{2}$/.test(k)) countries[k] = { firstAt: num(obj(c).firstAt), minutes: num(obj(c).minutes) }
  const stations: Progress['stations'] = {}
  for (const [k, s] of Object.entries(obj(raw.stations)).slice(0, MAX_STAMPED_STATIONS)) {
    const o = obj(s)
    if (typeof o.name !== 'string' || k.length > 64) continue
    const coord = (x: unknown, lim: number) => (typeof x === 'number' && Math.abs(x) <= lim ? x : null)
    stations[k] = {
      name: o.name.slice(0, 80), country: typeof o.country === 'string' ? o.country.slice(0, 2) : '', location: typeof o.location === 'string' ? o.location.slice(0, 80) : '',
      lat: coord(o.lat, 90), lon: coord(o.lon, 180), firstAt: num(o.firstAt), minutes: num(o.minutes),
    }
  }
  const celebrated = Array.isArray(raw.celebrated) ? raw.celebrated.filter((x): x is string => typeof x === 'string').slice(0, 100) : []
  return { days, countries, stations, celebrated }
}
