import { CITY_BY_ID } from '../constants/cities'
import { mapView } from '../render/mapSnapshot'
import type { AudioParams, WeatherControls } from '../store/useRadioStore'
import type { SolarPhase, Station, WeatherType } from '../types'
import { clamp } from '../utils/math'

/**
 * "A way to listen": a station plus the mood around it. Atmospheres, saved setups, the
 * last session and session links all use this. Volume, screen effects and Calm belong
 * to the listener and are never part of a setup.
 */

export const MIX_KEYS = ['rain', 'wind', 'city', 'fire', 'pad', 'staticBlend', 'hiss', 'cutoff'] as const
export type MixKey = (typeof MIX_KEYS)[number]
export type SoundMix = Pick<AudioParams, MixKey>

export interface MapViewSpec {
  lon: number
  lat: number
  zoom: number
}

export interface SessionSettings {
  /** Where the map looks; null flies to the station */
  view: MapViewSpec | null
  weather: WeatherControls
  sky: 'auto' | SolarPhase
  mix: SoundMix
  /** Geo Link: ambience follows the map. Atmospheres turn it off so their mix holds */
  ambientLinked: boolean
  atmosphereId: string | null
  /** Focus timer lengths in minutes, offered (not forced) when the setup starts */
  timer: { work: number; short: number } | null
  /** Name of a listener-made mood, so a link to it can still say which mood it is */
  moodName?: string | null
}

export interface Setup extends SessionSettings {
  station: Station
}

export interface SavedSetup {
  id: string
  name: string
  setup: Setup
  savedAt: number
}

export interface LastSession extends Setup {
  savedAt: number
}

/** Where a mood's music comes from: what's already playing, a station near a city, or a genre. */
export type StationPick = { kind: 'keep' } | { kind: 'city'; cityId: string } | { kind: 'tag'; tags: string[] }

/** The scene a mood sets. Moods never move the map themselves (the station decides). */
export type MoodSettings = Omit<SessionSettings, 'atmosphereId' | 'moodName' | 'view'>

/** A mood the listener made: a music source plus a scene, kept in the library. */
export interface CustomMood {
  /** Always `my-…`, so it can't collide with a built-in and still fits a link's `atm=` */
  id: string
  name: string
  /** Optional one line for the chooser */
  tagline: string
  pick: StationPick
  settings: MoodSettings
  savedAt: number
}

export const MOOD_ID = /^my-[a-z0-9]{1,30}$/
export const isCustomMoodId = (id: string | null | undefined) => !!id && MOOD_ID.test(id)
const MOOD_NAME_MAX = 40

/** Genre tags as typed ("Jazz, lo-fi"): trimmed, lower case, no repeats, at most four. */
export const cleanTags = (tags: unknown[]): string[] =>
  [...new Set(tags.flatMap((t) => (typeof t === 'string' ? [t.trim().toLowerCase().slice(0, 30)] : [])).filter(Boolean))].slice(0, 4)

export function sanitizePick(v: unknown): StationPick | null {
  if (typeof v !== 'object' || v === null) return null
  const p = v as Record<string, unknown>
  if (p.kind === 'keep') return { kind: 'keep' }
  if (p.kind === 'city' && typeof p.cityId === 'string' && Object.hasOwn(CITY_BY_ID, p.cityId)) return { kind: 'city', cityId: p.cityId }
  if (p.kind === 'tag' && Array.isArray(p.tags)) {
    const tags = cleanTags(p.tags)
    return tags.length ? { kind: 'tag', tags } : null
  }
  return null
}

/** A mood name fit for a link or the display: one line, no control characters. */
const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  // oxlint-disable-next-line no-control-regex
  const name = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MOOD_NAME_MAX)
  return name || null
}

/** Validates a listener-made mood read back from storage or an account. */
export function sanitizeMood(v: unknown): CustomMood | null {
  if (typeof v !== 'object' || v === null) return null
  const raw = v as Record<string, unknown>
  const name = cleanName(raw.name)
  const pick = sanitizePick(raw.pick)
  const settings = typeof raw.settings === 'object' && raw.settings !== null ? sanitizeSettings({ ...raw.settings, view: null, atmosphereId: null }) : null
  if (typeof raw.id !== 'string' || !MOOD_ID.test(raw.id) || !name || !pick || !settings) return null
  return {
    id: raw.id,
    name,
    tagline: typeof raw.tagline === 'string' ? raw.tagline.trim().slice(0, 80) : '',
    pick,
    settings: { weather: settings.weather, sky: settings.sky, mix: settings.mix, ambientLinked: settings.ambientLinked, timer: settings.timer },
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
  }
}

export const WEATHER_MODES: WeatherControls['mode'][] = ['auto', 'clear', 'rain', 'storm', 'snow', 'embers']
export const SKY_MODES: ('auto' | SolarPhase)[] = ['auto', 'day', 'golden', 'night', 'aurora']

/** The current settings as a setup (station handled by the caller). */
export function captureSettings(s: {
  audio: AudioParams
  weather: WeatherControls
  solarOverride: 'auto' | SolarPhase
  ambientLinked: boolean
  atmosphere: { id: string; name?: string } | null
  focus: { settings: { work: number; short: number }; phase: string }
}): SessionSettings {
  const camera = mapView()?.camera ?? null
  const custom = s.atmosphere && isCustomMoodId(s.atmosphere.id) ? s.atmosphere : null
  return {
    view: camera ? { lon: round(camera.lon, 2), lat: round(camera.lat, 2), zoom: round(camera.zoom, 1) } : null,
    weather: { ...s.weather },
    sky: s.solarOverride,
    mix: Object.fromEntries(MIX_KEYS.map((k) => [k, s.audio[k]])) as SoundMix,
    ambientLinked: s.ambientLinked,
    atmosphereId: s.atmosphere?.id ?? null,
    timer: s.focus.phase !== 'idle' ? { work: s.focus.settings.work, short: s.focus.settings.short } : null,
    ...(custom?.name ? { moodName: custom.name } : {}),
  }
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

// --- Session links: /s/<station>?atm=…&mn=…&at=…&wx=…&sky=…&mix=…&geo=…&t=… ---

const pct = (v: number) => String(Math.round(clamp(v, 0, 1) * 99))
const unpct = (s: string | undefined) => (s !== undefined && /^\d{1,2}$/.test(s) ? Number(s) / 99 : null)

/** Settings as a short query string; every part is optional when read back. */
export function sessionQuery(s: SessionSettings): string {
  const q = new URLSearchParams()
  if (s.atmosphereId) q.set('atm', s.atmosphereId)
  // Built-in names are known everywhere; a listener's own mood carries its name
  const name = isCustomMoodId(s.atmosphereId) ? cleanName(s.moodName) : null
  if (name) q.set('mn', name)
  if (s.view) q.set('at', `${s.view.lon.toFixed(2)},${s.view.lat.toFixed(2)},${s.view.zoom.toFixed(1)}`)
  q.set('wx', `${s.weather.mode}.${pct(s.weather.density)}.${pct(s.weather.wind)}`)
  q.set('sky', s.sky)
  q.set('mix', MIX_KEYS.map((k) => pct(s.mix[k])).join('.'))
  q.set('geo', s.ambientLinked ? '1' : '0')
  if (s.timer) q.set('t', `${s.timer.work}-${s.timer.short}`)
  // %20 rather than +, so a mood name with spaces still fits a room's mood string
  return q.toString().replaceAll('+', '%20')
}

/** Read a session query. Anything malformed is dropped on its own; null when nothing usable is left. */
export function parseSessionQuery(search: string): Partial<SessionSettings> | null {
  const q = new URLSearchParams(search)
  const out: Partial<SessionSettings> = {}
  const atm = q.get('atm')
  if (atm && /^[a-z0-9-]{1,40}$/.test(atm)) out.atmosphereId = atm
  const mn = isCustomMoodId(out.atmosphereId) ? cleanName(q.get('mn')) : null
  if (mn) out.moodName = mn
  const at = q.get('at')?.split(',').map(Number)
  if (at?.length === 3 && at.every(Number.isFinite) && Math.abs(at[0]) <= 180 && Math.abs(at[1]) <= 90) {
    out.view = { lon: at[0], lat: at[1], zoom: clamp(at[2], 1, 32) }
  }
  const [mode, density, wind] = q.get('wx')?.split('.') ?? []
  const d = unpct(density)
  const w = unpct(wind)
  if (WEATHER_MODES.includes(mode as WeatherType) && d !== null && w !== null) out.weather = { mode: mode as WeatherControls['mode'], density: d, wind: w }
  const sky = q.get('sky')
  if (SKY_MODES.includes(sky as SolarPhase)) out.sky = sky as SessionSettings['sky']
  const mix = q.get('mix')?.split('.').map(unpct)
  if (mix?.length === MIX_KEYS.length && mix.every((v) => v !== null)) {
    out.mix = Object.fromEntries(MIX_KEYS.map((k, i) => [k, mix[i]])) as SoundMix
  }
  const geo = q.get('geo')
  if (geo === '0' || geo === '1') out.ambientLinked = geo === '1'
  const t = /^(\d{1,3})-(\d{1,2})$/.exec(q.get('t') ?? '')
  if (t) {
    const work = Number(t[1])
    const short = Number(t[2])
    if (work >= 1 && work <= 180 && short >= 1 && short <= 60) out.timer = { work, short }
  }
  return Object.keys(out).length ? out : null
}

/** Validates a setup's settings read back from storage; null when the core of it is unusable. */
export function sanitizeSettings(v: unknown): SessionSettings | null {
  if (typeof v !== 'object' || v === null) return null
  // Reuse the link parser's rules by round-tripping through a query
  const settings = v as SessionSettings
  let parsed: Partial<SessionSettings> | null = null
  try {
    parsed = parseSessionQuery(sessionQuery({
      view: settings.view ?? null,
      weather: settings.weather,
      sky: settings.sky,
      mix: settings.mix,
      ambientLinked: settings.ambientLinked !== false,
      atmosphereId: typeof settings.atmosphereId === 'string' ? settings.atmosphereId : null,
      timer: settings.timer ?? null,
      moodName: settings.moodName ?? null,
    }))
  } catch {
    return null
  }
  if (!parsed?.weather || !parsed.mix || !parsed.sky) return null
  return {
    view: parsed.view ?? null,
    weather: parsed.weather,
    sky: parsed.sky,
    mix: parsed.mix,
    ambientLinked: parsed.ambientLinked ?? true,
    atmosphereId: parsed.atmosphereId ?? null,
    timer: parsed.timer ?? null,
    ...(parsed.moodName ? { moodName: parsed.moodName } : {}),
  }
}

/** Validates a setup read back from storage. */
export function sanitizeSetup(v: unknown, isStation: (s: unknown) => s is Station): Setup | null {
  if (typeof v !== 'object' || v === null) return null
  const raw = v as Record<string, unknown>
  if (!isStation(raw.station)) return null
  const settings = sanitizeSettings(raw)
  return settings ? { station: raw.station, ...settings } : null
}
