import { findMood } from './moods'
import type { MoodSettings, SessionSettings } from './setup'

export const SKY_WORD: Record<string, string> = { day: 'daylight', golden: 'golden hour', night: 'night', aurora: 'aurora' }
/** How a chosen weather reads in a sentence */
export const WEATHER_WORD: Record<string, string> = { clear: 'clear sky', rain: 'rain', storm: 'storm', snow: 'snow', embers: 'embers' }

/** "Rainy Tokyo · themed rain · night · 50-min focus", from whatever the settings say. */
export function moodLine(settings: Partial<SessionSettings>, withName = true): string {
  const parts: string[] = []
  const name = settings.atmosphereId ? (findMood(settings.atmosphereId)?.name ?? settings.moodName) : null
  if (name && withName) parts.push(name)
  if (settings.weather) parts.push(settings.weather.mode === 'auto' ? 'live weather' : `themed ${WEATHER_WORD[settings.weather.mode]}`)
  if (settings.sky && settings.sky !== 'auto') parts.push(SKY_WORD[settings.sky] ?? settings.sky)
  if (settings.timer) parts.push(`${settings.timer.work}-min focus`)
  return parts.join(' · ')
}

/** The background sounds, in the order the deck's faders show them */
const SOUNDS = [['pad', 'synth pad'], ['rain', 'rain'], ['wind', 'wind'], ['city', 'city'], ['fire', 'fire']] as const
/** Below this a sound is too quiet to mention */
const AUDIBLE = 0.2

/** What a mood will change, for its card: "Rain · night · rain, city, synth pad · 50-min focus". */
export function sceneLine(settings: Pick<MoodSettings, 'weather' | 'sky' | 'mix' | 'timer'>): string {
  const { mode } = settings.weather
  const parts = [mode === 'auto' ? 'live weather' : WEATHER_WORD[mode]]
  if (settings.sky !== 'auto') parts.push(SKY_WORD[settings.sky] ?? settings.sky)
  const sounds = SOUNDS.filter(([key]) => settings.mix[key] >= AUDIBLE).map(([, word]) => word)
  parts.push(sounds.length ? sounds.join(', ') : 'no background sounds')
  if (settings.timer) parts.push(`${settings.timer.work}-min focus`)
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null

/** "5 minutes ago", "yesterday", "3 days ago". */
export function ago(then: number, now = Date.now()): string {
  const s = Math.round((then - now) / 1000)
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12]]
  let value = s
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return rtf?.format(Math.round(value), unit) ?? ''
    value /= size
  }
  return rtf?.format(Math.round(value), 'year') ?? ''
}
