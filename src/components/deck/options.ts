import { CUTOFF_MAX, CUTOFF_MIN } from '../../constants/audio'
import type { WeatherControls } from '../../store/useRadioStore'
import type { SolarPhase } from '../../types'

/** Control lists shared by the deck and the mood editor, so both read the same. */

export const formatHz = (v: number) => {
  const hz = CUTOFF_MIN * Math.pow(CUTOFF_MAX / CUTOFF_MIN, v)
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`
}

/** Wind as a direction and strength: ◀ blows left, ▶ right */
export const formatWind = (v: number) => `${v < 0.5 ? '◀' : v > 0.5 ? '▶' : ''}${Math.round(Math.abs(v - 0.5) * 200)}`

export const ATMOS_FADERS: { key: 'pad' | 'rain' | 'wind' | 'city' | 'fire'; label: string }[] = [
  { key: 'pad', label: 'Pad' },
  { key: 'rain', label: 'Rain' },
  { key: 'wind', label: 'Wind' },
  { key: 'city', label: 'City' },
  { key: 'fire', label: 'Fire' },
]

export const SKY_OPTIONS: { value: 'auto' | SolarPhase; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'day', label: 'Day' },
  { value: 'golden', label: 'Gold' },
  { value: 'night', label: 'Night' },
  { value: 'aurora', label: 'Aurora' },
]

export const WEATHER_OPTIONS: { value: WeatherControls['mode']; label: string }[] = [
  { value: 'auto', label: 'Live' },
  { value: 'clear', label: 'Clear' },
  { value: 'rain', label: 'Rain' },
  { value: 'storm', label: 'Storm' },
  { value: 'snow', label: 'Snow' },
  { value: 'embers', label: 'Embers' },
]
