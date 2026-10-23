import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { randomAvatar, type Avatar } from '../avatar/parts'
import { PUBLIC_MODES, sanitizeAvatar, type Crowd, type FriendInfo, type PublicMode, type PublicWalker, type RoomInfo, type SelfInfo, type SharedStation } from '../social/protocol'
import { EMPTY_PROGRESS, sanitizeProgress, type Progress } from '../progress/progress'
import { sanitizeSetup, type LastSession, type SavedSetup, type SessionSettings } from '../session/setup'
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
  /** What the listener really wanted, when this station already stands in for it (e.g. the directory was down) */
  standIn?: string
}

/**
 * Playing something other than what was asked for, or nothing at all: said plainly, with a
 * way back. `wanted` names what was asked for ("KEXP", "stations in Tokyo").
 */
export interface Fallback {
  wanted: string
  /** The station that was asked for, when there was one, for Retry and "another nearby" */
  wantedStation: Station | null
  reason: 'no-answer' | 'dropped' | 'directory' | 'failed'
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
  /** Named setups: a station plus its weather, sky and mix */
  setups: SavedSetup[]
}

export type DrawerTab = 'moods' | 'favorites' | 'recent' | 'friends' | 'avatar' | 'passport' | 'account'

/** A session link waiting for the listener's click */
export interface PendingSession {
  stationId: string
  /** Filled in once the station is looked up */
  station: Station | null
  settings: Partial<SessionSettings>
}

export type FriendsStatus = 'unconfigured' | 'signed-out' | 'connecting' | 'online' | 'offline'

export interface FriendsState {
  status: FriendsStatus
  self: SelfInfo | null
  list: FriendInfo[]
  /** Last problem worth showing in the friends panel */
  error: string | null
  /** When each friend's presence arrived (ms), for focus countdowns */
  receivedAt: Record<string, number>
  /** Friend code from an invite link that hasn't been added yet */
  invite: string | null
  /** Protocol version the server speaks; rooms and the public world need 2 */
  serverVersion: number
}

/** Sync state of the optional account (the account itself is the friends identity). */
export interface AccountState {
  status: 'none' | 'syncing' | 'synced' | 'error'
  /** When the last save or load finished (ms) */
  lastSync: number | null
  error: string | null
}

export interface SocialPrefs {
  shareListening: boolean
  appearOffline: boolean
  /** How strangers see you in the public world */
  publicMode: PublicMode
  /** Everyone on the map, or only friends */
  mapFilter: 'everyone' | 'friends'
  /** In a room, tune along when the host changes station */
  followRoom: boolean
}

export interface RoomInvite {
  code: string
  from: { userId: string; name: string }
  station: SharedStation | null
  at: number
}

/** The public world: everyone online who isn't hidden. */
export interface WorldInfo {
  /** Your own pid on this connection */
  pid: string | null
  /** Walkers by pid */
  walkers: Record<string, PublicWalker>
  /** Listener counts by station, busiest first */
  crowds: Crowd[]
  online: number
  /** A snapshot has arrived on the current connection */
  synced: boolean
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
  /** Song currently announced by the playing station, when it shares one */
  nowPlaying: { stationId: string; title: string } | null
  friends: FriendsState
  social: SocialPrefs
  account: AccountState
  world: WorldInfo
  /** The listening room you're in */
  room: RoomInfo | null
  roomInvites: RoomInvite[]
  /** Station from a shared link, waiting for the power-on gesture */
  launch: Station | null
  /** Short notice shown at the bottom of the screen */
  toast: { text: string; nonce: number } | null
  fallback: Fallback | null
  /** The journey being followed, at which stop */
  journey: { id: string; index: number } | null
  /** The themed atmosphere in effect, if any */
  atmosphere: { id: string; name: string } | null
  /** What was playing last time, to resume */
  lastSession: LastSession | null
  /** Focus history and the listening passport */
  progress: Progress
  pendingSession: PendingSession | null

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
  requestStation: (station: Station, fly: boolean, standIn?: string) => void
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
  setNowPlaying: (nowPlaying: { stationId: string; title: string } | null) => void
  setFriends: (patch: Partial<FriendsState>) => void
  setSocial: (patch: Partial<SocialPrefs>) => void
  setAccount: (patch: Partial<AccountState>) => void
  /** Replace the synced parts of the state with an account's copy */
  applySynced: (data: Pick<RadioState, 'library' | 'avatar' | 'progress'>) => void
  setWorld: (patch: Partial<WorldInfo>) => void
  setRoom: (room: RoomInfo | null) => void
  setRoomInvites: (invites: RoomInvite[]) => void
  setLaunch: (station: Station | null) => void
  showToast: (text: string) => void
  setAtmosphere: (atmosphere: { id: string; name: string } | null) => void
  setFallback: (fallback: Fallback | null) => void
  setJourney: (journey: { id: string; index: number } | null) => void
  setLastSession: (session: LastSession | null) => void
  setProgress: (progress: Progress) => void
  setPendingSession: (pending: PendingSession | null) => void
  saveSetup: (setup: SavedSetup) => void
  renameSetup: (id: string, name: string) => void
  removeSetup: (id: string) => void
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
export const MAX_SETUPS = 30

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

type Persisted = Pick<RadioState, 'audio' | 'ambientLinked' | 'crt' | 'fx' | 'weather' | 'solarOverride' | 'library' | 'social' | 'deckExpanded' | 'avatar' | 'lastSession' | 'atmosphere' | 'progress'> & {
  focus: Pick<FocusState, 'settings' | 'completed' | 'completedDay'>
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const pick = <T extends object>(base: T, saved: unknown): T => {
  if (!isObject(saved)) return base
  const out = { ...base }
  for (const key of Object.keys(base) as (keyof T)[]) {
    if (typeof saved[key as string] === typeof base[key]) out[key] = saved[key as string] as T[keyof T]
  }
  return out
}
const isStation = (s: unknown): s is Station => isObject(s) && typeof s.id === 'string' && typeof s.url === 'string' && typeof s.name === 'string'
export const stationList = (v: unknown, max: number): Station[] => (Array.isArray(v) ? v.filter(isStation).slice(0, max) : [])
export const setupList = (v: unknown): SavedSetup[] =>
  Array.isArray(v)
    ? v.flatMap((item) => {
        if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return []
        const setup = sanitizeSetup(item.setup, isStation)
        return setup ? [{ id: item.id, name: item.name.slice(0, 40), setup, savedAt: typeof item.savedAt === 'number' ? item.savedAt : 0 }] : []
      }).slice(0, MAX_SETUPS)
    : []

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
      library: { favorites: [], recents: [], setups: [] },
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
      nowPlaying: null,
      friends: { status: 'unconfigured', self: null, list: [], error: null, receivedAt: {}, invite: null, serverVersion: 0 },
      social: { shareListening: true, appearOffline: false, publicMode: 'anonymous', mapFilter: 'everyone', followRoom: true },
      account: { status: 'none', lastSync: null, error: null },
      room: null,
      roomInvites: [],
      world: { pid: null, walkers: {}, crowds: [], online: 0, synced: false },
      launch: null,
      toast: null,
      fallback: null,
      journey: null,
      atmosphere: null,
      lastSession: null,
      progress: EMPTY_PROGRESS,
      pendingSession: null,

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
      requestStation: (station, fly, standIn) =>
        set((s) => ({ stationRequest: { station, fly, standIn, nonce: (s.stationRequest?.nonce ?? 0) + 1 } })),
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
      setNowPlaying: (nowPlaying) => set({ nowPlaying }),
      setFriends: (patch) => set((s) => ({ friends: { ...s.friends, ...patch } })),
      setSocial: (patch) => set((s) => ({ social: { ...s.social, ...patch } })),
      setAccount: (patch) => set((s) => ({ account: { ...s.account, ...patch } })),
      applySynced: ({ library, avatar, progress }) => set({ library, avatar, progress }),
      setWorld: (patch) => set((s) => ({ world: { ...s.world, ...patch } })),
      setRoom: (room) => set({ room }),
      setRoomInvites: (roomInvites) => set({ roomInvites }),
      setLaunch: (launch) => set({ launch }),
      setAtmosphere: (atmosphere) => set({ atmosphere }),
      setFallback: (fallback) => set({ fallback }),
      setJourney: (journey) => set({ journey }),
      setLastSession: (lastSession) => set({ lastSession }),
      setProgress: (progress) => set({ progress }),
      setPendingSession: (pendingSession) => set({ pendingSession }),
      saveSetup: (setup) =>
        set(({ library }) => ({ library: { ...library, setups: [setup, ...library.setups.filter((x) => x.id !== setup.id)].slice(0, MAX_SETUPS) } })),
      renameSetup: (id, name) =>
        set(({ library }) => ({ library: { ...library, setups: library.setups.map((x) => (x.id === id ? { ...x, name } : x)) } })),
      removeSetup: (id) => set(({ library }) => ({ library: { ...library, setups: library.setups.filter((x) => x.id !== id) } })),
      showToast: (text) => set((s) => ({ toast: { text, nonce: (s.toast?.nonce ?? 0) + 1 } })),
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
        lastSession: s.lastSession,
        atmosphere: s.atmosphere,
        progress: s.progress,
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
        const social = pick(current.social, saved.social)
        const today = localDay()
        return {
          ...current,
          audio: pick(current.audio, saved.audio),
          ambientLinked: typeof saved.ambientLinked === 'boolean' ? saved.ambientLinked : current.ambientLinked,
          crt: pick(current.crt, saved.crt),
          fx: pick(current.fx, saved.fx),
          weather: weatherModes.includes(weather.mode) ? weather : { ...weather, mode: 'auto' },
          solarOverride: sky.includes(saved.solarOverride as string) ? (saved.solarOverride as RadioState['solarOverride']) : current.solarOverride,
          library: {
            favorites: stationList(library.favorites, MAX_FAVORITES),
            recents: stationList(library.recents, MAX_RECENTS),
            setups: setupList(library.setups),
          },
          lastSession: (() => {
            const last = isObject(saved.lastSession) ? sanitizeSetup(saved.lastSession, isStation) : null
            const at = isObject(saved.lastSession) ? saved.lastSession.savedAt : null
            return last && typeof at === 'number' ? { ...last, savedAt: at } : null
          })(),
          progress: sanitizeProgress(saved.progress),
          atmosphere:
            isObject(saved.atmosphere) && typeof saved.atmosphere.id === 'string' && typeof saved.atmosphere.name === 'string'
              ? { id: saved.atmosphere.id, name: saved.atmosphere.name }
              : null,
          social: {
            ...social,
            publicMode: PUBLIC_MODES.includes(social.publicMode) ? social.publicMode : current.social.publicMode,
            mapFilter: social.mapFilter === 'friends' ? 'friends' : 'everyone',
          },
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

/** The playing station's current song, if it belongs to the station on the display. */
export const currentSong = (s: Pick<RadioState, 'nowPlaying' | 'station'>) =>
  s.nowPlaying && s.station && s.nowPlaying.stationId === s.station.id ? s.nowPlaying.title : null
