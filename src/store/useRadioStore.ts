import { create } from 'zustand'
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

export interface WeatherControls {
  mode: 'auto' | WeatherType
  /** Particle density multiplier, 0..1 (0.5 = preset) */
  density: number
  /** Manual wind, 0..1 (0.5 = calm / preset) */
  wind: number
}

export type TuneStatus = 'idle' | 'tuning' | 'playing' | 'error'

export interface StationRequest {
  station: Station
  /** Ask the map camera to fly to the station */
  fly: boolean
  nonce: number
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
  solarOverride: 'auto' | SolarPhase
  activePhase: SolarPhase
  weather: WeatherControls
  /** Bumped to ask the map camera to return to the world view */
  viewResetNonce: number
  /** Bumped whenever a city is chosen, even the same one again, so the camera re-focuses */
  focusNonce: number
  /** Latest request to tune an individual station (map dot or search result) */
  stationRequest: StationRequest | null
  /** Stations currently plotted on the map */
  stationCount: number

  setPowered: (powered: boolean) => void
  selectCity: (id: string | null) => void
  setStations: (stations: Station[]) => void
  setStation: (station: Station | null, index: number, analyzed: boolean) => void
  setTune: (status: TuneStatus, text: string) => void
  setAudio: (patch: Partial<AudioParams>) => void
  setAmbientLinked: (linked: boolean) => void
  setGeoMix: (mix: AmbientMix) => void
  setCrt: (patch: Partial<CrtParams>) => void
  setSolarOverride: (phase: 'auto' | SolarPhase) => void
  setActivePhase: (phase: SolarPhase) => void
  setWeather: (patch: Partial<WeatherControls>) => void
  resetView: () => void
  requestStation: (station: Station, fly: boolean) => void
  setStationCount: (count: number) => void
}

export const DEFAULT_AUDIO: AudioParams = {
  master: 0.8,
  stream: 0.8,
  staticBlend: 0.12,
  hiss: 0.25,
  cutoff: 1,
  pad: 0.5,
  rain: 0.7,
  wind: 0.6,
  city: 0.6,
  fire: 0.7,
}

export const useRadioStore = create<RadioState>((set) => ({
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
  crt: { enabled: true, scanlines: true, aberration: true, flicker: true, curvature: true },
  solarOverride: 'auto',
  activePhase: 'day',
  weather: { mode: 'auto', density: 0.5, wind: 0.5 },
  viewResetNonce: 0,
  focusNonce: 0,
  stationRequest: null,
  stationCount: 0,

  setPowered: (powered) => set({ powered }),
  selectCity: (id) => set((s) => ({ selectedCityId: id, focusNonce: s.focusNonce + 1 })),
  setStations: (stations) => set({ stations }),
  setStation: (station, stationIndex, analyzed) => set({ station, stationIndex, analyzed }),
  setTune: (tuneStatus, statusText) => set({ tuneStatus, statusText }),
  setAudio: (patch) => set((s) => ({ audio: { ...s.audio, ...patch } })),
  setAmbientLinked: (ambientLinked) => set({ ambientLinked }),
  setGeoMix: (geoMix) => set({ geoMix }),
  setCrt: (patch) => set((s) => ({ crt: { ...s.crt, ...patch } })),
  setSolarOverride: (solarOverride) => set({ solarOverride }),
  setActivePhase: (activePhase) => set({ activePhase }),
  setWeather: (patch) => set((s) => ({ weather: { ...s.weather, ...patch } })),
  resetView: () => set((s) => ({ viewResetNonce: s.viewResetNonce + 1 })),
  requestStation: (station, fly) =>
    set((s) => ({ stationRequest: { station, fly, nonce: (s.stationRequest?.nonce ?? 0) + 1 } })),
  setStationCount: (stationCount) => set({ stationCount }),
}))
