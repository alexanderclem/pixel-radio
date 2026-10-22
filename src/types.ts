export type SolarPhase = 'day' | 'golden' | 'night' | 'aurora'
export type WeatherType = 'clear' | 'rain' | 'storm' | 'snow' | 'embers'
export type PadMood = 'warm' | 'dreamy' | 'noir' | 'bright'

export interface AmbientMix {
  rain: number
  wind: number
  city: number
  fire: number
}

export type AmbientChannelId = keyof AmbientMix

export interface CityWeather {
  type: WeatherType
  /** 0..1 particle density / storm strength */
  intensity: number
  /** -1..1 horizontal wind, negative blows left */
  wind: number
}

export interface CityPreset {
  id: string
  /** Three-letter dial code shown on preset buttons */
  code: string
  name: string
  country: string
  countryCode: string
  timeZone: string
  lat: number
  lon: number
  /** Position on the FM dial (88–108 MHz) */
  freq: number
  ambient: AmbientMix
  weather: CityWeather
  mood: PadMood
}

export interface Station {
  id: string
  name: string
  url: string
  hls: boolean
  codec: string
  bitrate: number
  /** ISO 3166-1 alpha-2 */
  country: string
  /** Region/state as reported by Radio Browser */
  state: string
  /** Human-readable "State, Country" */
  location: string
  homepage: string
  tags: string
  /** Radio Browser click count, used to pick cluster representatives */
  popularity: number
  lat: number | null
  lon: number | null
  /** True when the station had no coordinates and was placed near others in its region */
  approx: boolean
  source: 'radio-browser' | 'curated'
}
