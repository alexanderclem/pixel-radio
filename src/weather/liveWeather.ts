import type { WeatherType } from '../types'
import { clamp } from '../utils/math'

/**
 * Current weather from Open-Meteo (free for non-commercial use, no key, CORS-enabled),
 * fetched by the browser itself so each listener's requests count against their own
 * address. Results are cached per half-degree cell, and failures back off.
 */

export interface LiveWeather {
  type: WeatherType
  /** 0..1 particle density / storm strength, as in a city preset */
  intensity: number
  /** -1..1 horizontal wind, negative blows left */
  wind: number
  /** Short HUD word: CLEAR, CLOUDY, FOG, DRIZZLE, RAIN, SNOW, STORM */
  label: string
  /** Air temperature in °C */
  tempC: number | null
}

/** WMO weather interpretation codes → what the map can draw. */
const CODES: Record<number, [WeatherType, number, string]> = {
  0: ['clear', 0, 'CLEAR'],
  1: ['clear', 0, 'CLEAR'],
  2: ['clear', 0, 'CLOUDY'],
  3: ['clear', 0, 'CLOUDY'],
  45: ['clear', 0, 'FOG'],
  48: ['clear', 0, 'FOG'],
  51: ['rain', 0.2, 'DRIZZLE'],
  53: ['rain', 0.3, 'DRIZZLE'],
  55: ['rain', 0.4, 'DRIZZLE'],
  56: ['rain', 0.3, 'DRIZZLE'],
  57: ['rain', 0.4, 'DRIZZLE'],
  61: ['rain', 0.4, 'RAIN'],
  63: ['rain', 0.6, 'RAIN'],
  65: ['rain', 0.9, 'RAIN'],
  66: ['rain', 0.5, 'RAIN'],
  67: ['rain', 0.8, 'RAIN'],
  71: ['snow', 0.4, 'SNOW'],
  73: ['snow', 0.6, 'SNOW'],
  75: ['snow', 0.9, 'SNOW'],
  77: ['snow', 0.3, 'SNOW'],
  80: ['rain', 0.5, 'RAIN'],
  81: ['rain', 0.7, 'RAIN'],
  82: ['rain', 1, 'RAIN'],
  85: ['snow', 0.5, 'SNOW'],
  86: ['snow', 0.9, 'SNOW'],
  95: ['storm', 0.7, 'STORM'],
  96: ['storm', 0.85, 'STORM'],
  99: ['storm', 1, 'STORM'],
}

/** Wind speed (km/h) that maps to full particle drift. */
const FULL_WIND_KMH = 40

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Open-Meteo `current` block → map weather; null when the response isn't usable. */
export function fromOpenMeteo(body: unknown): LiveWeather | null {
  const current = typeof body === 'object' && body !== null ? (body as { current?: unknown }).current : null
  if (typeof current !== 'object' || current === null) return null
  const c = current as Record<string, unknown>
  const code = num(c.weather_code)
  const entry = code === null ? undefined : CODES[code]
  if (!entry) return null
  const speed = Math.max(0, num(c.wind_speed_10m) ?? 0)
  const from = num(c.wind_direction_10m)
  // Direction is where the wind comes from (270 = westerly), so it blows the other way
  const east = from === null ? 0 : -Math.sin((from * Math.PI) / 180)
  const temp = num(c.temperature_2m)
  return {
    type: entry[0],
    intensity: entry[1],
    // `|| 0` turns a north/south wind's -0 into a plain 0
    wind: clamp((east * speed) / FULL_WIND_KMH, -1, 1) || 0,
    label: entry[2],
    tempC: temp === null ? null : Math.round(temp),
  }
}

/** Rain and wind bed levels (0..1) for the ambient mixer. */
export function ambientOf(w: LiveWeather): { rain: number; wind: number } {
  const wet = w.type === 'rain' || w.type === 'storm'
  return {
    rain: wet ? clamp(0.3 + 0.7 * w.intensity, 0, 1) : 0,
    wind: clamp(0.15 + Math.abs(w.wind) * 0.85 + (w.type === 'snow' || w.type === 'storm' ? 0.2 : 0), 0, 1),
  }
}

/** Places that use Fahrenheit. */
const FAHRENHEIT_REGIONS = new Set(['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'])

export function formatTemp(c: number, locale = typeof navigator === 'undefined' ? 'en' : navigator.language) {
  let region = ''
  try {
    region = new Intl.Locale(locale).maximize().region ?? ''
  } catch {
    // Unparseable locale: Celsius
  }
  return FAHRENHEIT_REGIONS.has(region) ? `${Math.round((c * 9) / 5 + 32)}°F` : `${c}°C`
}

/** Half-degree cells (~55 km): close enough for weather, and nearby stations share a fetch. */
export const cellOf = (lat: number, lon: number) => {
  const cl = clamp(Math.round(lat * 2) / 2, -90, 90)
  let cn = Math.round(lon * 2) / 2
  if (cn >= 180) cn -= 360
  if (cn < -180) cn += 360
  return { lat: cl, lon: cn, key: `${cl},${cn}` }
}

export const openMeteoUrl = (lat: number, lon: number) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,temperature_2m,wind_speed_10m,wind_direction_10m`

const FRESH_MS = 20 * 60_000
const RETRY_MS = 3 * 60_000
const MAX_CELLS = 64
const TIMEOUT_MS = 8000

interface Cell {
  weather: LiveWeather | null
  /** When to fetch again */
  refreshAt: number
}

interface Options {
  fetchImpl?: typeof fetch
  now?: () => number
}

export class LiveWeatherService {
  private cells = new Map<string, Cell>()
  private inFlight: string | null = null
  private fetchImpl: typeof fetch
  private now: () => number

  constructor({ fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now() }: Options = {}) {
    this.fetchImpl = fetchImpl
    this.now = now
  }

  /**
   * Latest weather for the cell around (lat, lon), possibly stale, or null when none has
   * arrived yet. Asks for the cell when it's missing or due; cheap enough to call every second.
   */
  get(lat: number, lon: number): LiveWeather | null {
    const cell = cellOf(lat, lon)
    const known = this.cells.get(cell.key)
    if (known) {
      // Keep recently used cells at the back of the eviction order
      this.cells.delete(cell.key)
      this.cells.set(cell.key, known)
    }
    if ((!known || this.now() >= known.refreshAt) && this.inFlight === null) void this.load(cell)
    return known?.weather ?? null
  }

  private async load(cell: ReturnType<typeof cellOf>) {
    this.inFlight = cell.key
    const previous = this.cells.get(cell.key)?.weather ?? null
    let weather: LiveWeather | null = null
    try {
      const res = await this.fetchImpl(openMeteoUrl(cell.lat, cell.lon), { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.ok) weather = fromOpenMeteo(await res.json())
    } catch {
      // Offline, blocked or slow: keep what we had and try again later
    }
    this.cells.delete(cell.key)
    this.cells.set(cell.key, { weather: weather ?? previous, refreshAt: this.now() + (weather ? FRESH_MS : RETRY_MS) })
    while (this.cells.size > MAX_CELLS) this.cells.delete(this.cells.keys().next().value!)
    this.inFlight = null
  }
}

export const liveWeather = new LiveWeatherService()
