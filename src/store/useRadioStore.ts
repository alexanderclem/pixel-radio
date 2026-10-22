import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { randomAvatar, type Avatar } from '../avatar/parts'
import { sanitizeAvatar, type FriendInfo, type SelfInfo } from '../social/protocol'
import type { AmbientMix, SolarPhase, Station, WeatherType } from '../types'

/** Every control is stored as a normalised 0..1 value; the audio engine owns the mapping. */
export interface AudioParams {
  master: number
  stream: number
  staticBlend: number
  hiss: number
  cutoff: number
  pad: number
  rain: number
  wind: number
  city: number
  fire: number
}

export interface CrtParams {
  enabled: boolean
  scanlines: boolean
  aberration: boolean
  flicker: boolean
  curvature: boolean
}

export interface FxParams {
  /** Damps motion, flashes and screen effects */
  calm: boolean
}

export interface WeatherControls {
  mode: 'auto' | WeatherType
  /** Particle density multiplier, 0..1 (0.5 = preset) */
  density: number
  /** Manual wind, 0..1 (0.5 = calm / preset) */
  wind: number
}

export type TuneStatus = 'idle' | 'tuning' | 'playing' | 'error'

export interface FlyRequest {
  lon: number
  lat: number
  zoom: number
  nonce: number
}

export interface StationRequest {
  station: Station
  /** Ask the map camera to fly to the station */
  fly: boolean
  nonce: number
}

export interface FocusSettings {
  /** Phase lengths in minutes */
  work: number
  short: number
  long: number
  /** Every Nth completed focus session earns a long break */
  longEvery: number
  chime: boolean
  duckOnBreak: boolean
  notify: boolean
}

export type FocusPhase = 'idle' | 'focus' | 'break'

export interface FocusState {
  settings: FocusSettings
  phase: FocusPhase
  /** Wall-clock end of the running phase (ms), null when idle or paused */
  endsAt: number | null
  /** Time left while paused (ms) */
  pausedRemaining: number | null
  /** The running break is a long one */
  longBreak: boolean
  /** Focus sessions finished today */
  completed: number
  /** Local date (YYYY-MM-DD) `completed` counts for */
  completedDay: string
  /** Distraction-free layout */
  mode: boolean
}

export interface Library {
  favorites: Station[]
  recents: Station[]
}

export type DrawerTab = 'favorites' | 'recent' | 'friends' | 'avatar'

export type FriendsStatus = 'unconfigured' | 'signed-out' | 'connecting' | 'online' | 'offline'

export interface FriendsState {
  status: FriendsStatus
  self: SelfInfo | null
  list: FriendInfo[]
  /** Last problem worth showing in the friends panel */
  error: string | null
  /** When each friend's presence arrived (ms), for focus countdowns */
  receivedAt: Record<string, number>
}

export interface SocialPrefs {
  shareListening: boolean
  appearOffline: boolean
}

interface RadioState {
  powered: boolean
  retryNonce: number
  retryTune: () => void
  selectedCityId: string | null
  stations: Station[]
  stationIndex: number
  station: Station | null
  /** False when the stream is played outside the Web Audio graph (no CORS) */
  analyzed: boolean
  tuneStatus: TuneStatus
  statusText: string
  audio: AudioParams
  ambientLinked: boolean
  geoMix: AmbientMix
  crt: CrtParams
  fx: FxParams
  solarOverride: 'auto' | SolarPhase
  activePhase: SolarPhase
  weather: WeatherControls
  /** Bumped to ask the map camera to return to the world view */
  viewResetNonce: number
  /** Bumped whenever a city is chosen, even the same one again, so the camera re-focuses */
  focusNonce: number
  /** Bumped to ask the map camera to fly to the playing station */
  locateNonce: number
  /** Bumped to move keyboard focus into the station search */
  searchNonce: number
  /** Ask the map camera to fly somewhere (e.g. a friend's station) */
  flyRequest: FlyRequest | null
  /** Latest request to tune an individual station (map dot or search result) */
  stationRequest: StationRequest | null
  /** Stations currently plotted on the map */
  stationCount: number
  library: Library
  focus: FocusState
  drawer: DrawerTab | null
  helpOpen: boolean
  /** Full control deck (mixer, atmosphere, screen) instead of the compact one */
  deckExpanded: boolean
  /** Your pixel walker on the map */
  avatar: Avatar
  friends: FriendsState
  social: SocialPrefs

  setPowered: (powered: boolean) => void
  selectCity: (id: string | null) => void
  setStations: (stations: Station[]) => void
  setStation: (station: Station | null, index: number, analyzed: boolean) => void
  setTune: (status: TuneStatus, text: string) => void
  setAudio: (patch: Partial<AudioParams>) => void
  setAmbientLinked: (linked: boolean) => void
  setGeoMix: (mix: AmbientMix) => void
  setCrt: (patch: Partial<CrtParams>) => void
  setFx: (patch: Partial<FxParams>) => void
  setSolarOverride: (phase: 'auto' | SolarPhase) => void
  setActivePhase: (phase: SolarPhase) => void
  setWeather: (patch: Partial<WeatherControls>) => void
  resetView: () => void
  locateActive: () => void
  focusSearch: () => void
  flyTo: (lon: number, lat: number, zoom: number) => void
  requestStation: (station: Station, fly: boolean) => void
  setStationCount: (count: number) => void
  toggleFavorite: (station: Station) => void
  removeFavorite: (id: string) => void
  pushRecent: (station: Station) => void
  removeRecent: (id: string) => void
  setFocus: (patch: Partial<Omit<FocusState, 'settings'>>) => void
  setFocusSettings: (patch: Partial<FocusSettings>) => void
  setDrawer: (tab: DrawerTab | null) => void
  setHelpOpen: (open: boolean) => void
  setDeckExpanded: (expanded: boolean) => void
  setAvatar: (avatar: Avatar) => void
  setFriends: (patch: Partial<FriendsState>) => void
  setSocial: (patch: Partial<SocialPrefs>) => void
}

export const DEFAULT_AUDIO: AudioParams = {
  master: 0.8,
  stream: 0.8,
  staticBlend: 0.06,
  hiss: 0.15,
  cutoff: 1,
  pad: 0.5,
  rain: 0.7,
  wind: 0.6,
  city: 0.6,
  fire: 0.7,
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  work: 25,
  short: 5,
  long: 15,
  longEvery: 4,
  chime: true,
  duckOnBreak: true,
  notify: false,
}

export const MAX_FAVORITES = 50
export const MAX_RECENTS = 12

const prefersReducedMotion = () => {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Focus mode always runs calm; the Calm switch covers the rest of the time. */
export const isCalm = (s: Pick<RadioState, 'fx' | 'focus'>) => s.fx.calm || s.focus.mode

const withoutId = (list: Station[], id: string) => list.filter((s) => s.id !== id)

/** localStorage that degrades to "nothing saved" in private mode, sandboxes and Node. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return globalThis.localStorage?.getItem(name) ?? null
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      globalThis.localStorage?.setItem(name, value)
    } catch {
      // Quota or privacy mode: settings just won't survive a reload
    }
  },
  removeItem: (name) => {
    try {
      globalThis.localStorage?.removeItem(name)
    } catch {
      // As above
    }
  },
}

type Persisted = Pick<RadioState, 'audio' | 'ambientLinked' | 'crt' | 'fx' | 'weather' | 'solarOverride' | 'library' | 'social' | 'deckExpanded' | 'avatar'> & {
  focus: Pick<FocusState, 'settings' | 'completed' | 'completedDay'>
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const pick = <T extends object>(base: T, saved: unknown): T => {
  if (!isObject(saved)) return base
  const out = { ...base }
  for (const key of Object.keys(base) as (keyof T)[]) {
    if (typeof saved[key as string] === typeof base[key]) out[key] = saved[key as string] as T[keyof T]
  }
  return out
}
const stationList = (v: unknown, max: number): Station[] =>
  Array.isArray(v) ? v.filter((s): s is Station => isObject(s) && typeof s.id === 'string' && typeof s.url === 'string').slice(0, max) : []

export const useRadioStore = create<RadioState>()(
  persist(
    (set) => ({
      powered: false,
      retryNonce: 0,
      retryTune: () => set((s) => ({ retryNonce: s.retryNonce + 1 })),
      selectedCityId: null,
      stations: [],
      stationIndex: -1,
      station: null,
      analyzed: true,
      tuneStatus: 'idle',
      statusText: 'SELECT A CITY',
      audio: DEFAULT_AUDIO,
      ambientLinked: true,
      geoMix: { rain: 0, wind: 0, city: 0, fire: 0 },
      crt: { enabled: true, scanlines: true, aberration: true, flicker: false, curvature: true },
      fx: { calm: prefersReducedMotion() },
      solarOverride: 'auto',
      activePhase: 'day',
      weather: { mode: 'auto', density: 0.5, wind: 0.5 },
      viewResetNonce: 0,
      focusNonce: 0,
      locateNonce: 0,
      searchNonce: 0,
      flyRequest: null,
      stationRequest: null,
      stationCount: 0,
      library: { favorites: [], recents: [] },
      focus: {
        settings: DEFAULT_FOCUS_SETTINGS,
        phase: 'idle',
        endsAt: null,
        pausedRemaining: null,
        longBreak: false,
        completed: 0,
        completedDay: localDay(),
        mode: false,
      },
      drawer: null,
      helpOpen: false,
      deckExpanded: false,
      avatar: randomAvatar(),
      friends: { status: 'unconfigured', self: null, list: [], error: null, receivedAt: {} },
      social: { shareListening: true, appearOffline: false },

      setPowered: (powered) => set({ powered }),
      selectCity: (id) => set((s) => ({ selectedCityId: id, focusNonce: s.focusNonce + 1 })),
      setStations: (stations) => set({ stations }),
      setStation: (station, stationIndex, analyzed) => set({ station, stationIndex, analyzed }),
      setTune: (tuneStatus, statusText) => set({ tuneStatus, statusText }),
      setAudio: (patch) => set((s) => ({ audio: { ...s.audio, ...patch } })),
      setAmbientLinked: (ambientLinked) => set({ ambientLinked }),
      setGeoMix: (geoMix) => set({ geoMix }),
      setCrt: (patch) => set((s) => ({ crt: { ...s.crt, ...patch } })),
      setFx: (patch) => set((s) => ({ fx: { ...s.fx, ...patch } })),
      setSolarOverride: (solarOverride) => set({ solarOverride }),
      setActivePhase: (activePhase) => set({ activePhase }),
      setWeather: (patch) => set((s) => ({ weather: { ...s.weather, ...patch } })),
      resetView: () => set((s) => ({ viewResetNonce: s.viewResetNonce + 1 })),
      locateActive: () => set((s) => ({ locateNonce: s.locateNonce + 1 })),
      focusSearch: () => set((s) => ({ searchNonce: s.searchNonce + 1 })),
      flyTo: (lon, lat, zoom) => set((s) => ({ flyRequest: { lon, lat, zoom, nonce: (s.flyRequest?.nonce ?? 0) + 1 } })),
      requestStation: (station, fly) =>
        set((s) => ({ stationRequest: { station, fly, nonce: (s.stationRequest?.nonce ?? 0) + 1 } })),
      setStationCount: (stationCount) => set({ stationCount }),
      toggleFavorite: (station) =>
        set(({ library }) => ({
          library: {
            ...library,
            favorites: library.favorites.some((s) => s.id === station.id)
              ? withoutId(library.favorites, station.id)
              : [station, ...library.favorites].slice(0, MAX_FAVORITES),
          },
        })),
      removeFavorite: (id) => set(({ library }) => ({ library: { ...library, favorites: withoutId(library.favorites, id) } })),
      pushRecent: (station) =>
        set(({ library }) => ({
          library: { ...library, recents: [station, ...withoutId(library.recents, station.id)].slice(0, MAX_RECENTS) },
        })),
      removeRecent: (id) => set(({ library }) => ({ library: { ...library, recents: withoutId(library.recents, id) } })),
      setFocus: (patch) => set((s) => ({ focus: { ...s.focus, ...patch } })),
      setFocusSettings: (patch) => set((s) => ({ focus: { ...s.focus, settings: { ...s.focus.settings, ...patch } } })),
      setDrawer: (drawer) => set({ drawer }),
      setHelpOpen: (helpOpen) => set({ helpOpen }),
      setDeckExpanded: (deckExpanded) => set({ deckExpanded }),
      setAvatar: (avatar) => set({ avatar }),
      setFriends: (patch) => set((s) => ({ friends: { ...s.friends, ...patch } })),
      setSocial: (patch) => set((s) => ({ social: { ...s.social, ...patch } })),
    }),
    {
      name: 'pixel-radio.v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s): Persisted => ({
        audio: s.audio,
        ambientLinked: s.ambientLinked,
        crt: s.crt,
        fx: s.fx,
        weather: s.weather,
        solarOverride: s.solarOverride,
        library: s.library,
        social: s.social,
        deckExpanded: s.deckExpanded,
        avatar: s.avatar,
        focus: { settings: s.focus.settings, completed: s.focus.completed, completedDay: s.focus.completedDay },
      }),
      // Saved data is merged field by field over the defaults, so new settings get defaults
      // and anything malformed is ignored rather than crashing the deck.
      merge: (saved, current) => {
        if (!isObject(saved)) return current
        const focus = isObject(saved.focus) ? saved.focus : {}
        const library = isObject(saved.library) ? saved.library : {}
        const sky = ['auto', 'day', 'golden', 'night', 'aurora']
        const weatherModes = ['auto', 'clear', 'rain', 'storm', 'snow', 'embers']
        const weather = pick(current.weather, saved.weather)
        const today = localDay()
        return {
          ...current,
          audio: pick(current.audio, saved.audio),
          ambientLinked: typeof saved.ambientLinked === 'boolean' ? saved.ambientLinked : current.ambientLinked,
          crt: pick(current.crt, saved.crt),
          fx: pick(current.fx, saved.fx),
          weather: weatherModes.includes(weather.mode) ? weather : { ...weather, mode: 'auto' },
          solarOverride: sky.includes(saved.solarOverride as string) ? (saved.solarOverride as RadioState['solarOverride']) : current.solarOverride,
          library: { favorites: stationList(library.favorites, MAX_FAVORITES), recents: stationList(library.recents, MAX_RECENTS) },
          social: pick(current.social, saved.social),
          deckExpanded: typeof saved.deckExpanded === 'boolean' ? saved.deckExpanded : current.deckExpanded,
          avatar: sanitizeAvatar(saved.avatar) ?? current.avatar,
          focus: {
            ...current.focus,
            settings: pick(current.focus.settings, focus.settings),
            completed: focus.completedDay === today && typeof focus.completed === 'number' ? focus.completed : 0,
            completedDay: today,
          },
        }
      },
    },
  ),
)
