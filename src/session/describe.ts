import type { SessionSettings } from './setup'
import { ATMOSPHERE_BY_ID } from './atmospheres'

const SKY_WORD: Record<string, string> = { day: 'daylight', golden: 'golden hour', night: 'night', aurora: 'aurora' }
/** How a chosen weather reads in a sentence */
export const WEATHER_WORD: Record<string, string> = { clear: 'clear sky', rain: 'rain', storm: 'storm', snow: 'snow', embers: 'embers' }

/** "Rainy Tokyo · themed rain · night · 50-min focus", from whatever the settings say. */
export function moodLine(settings: Partial<SessionSettings>, withName = true): string {
  const parts: string[] = []
  const atm = settings.atmosphereId ? ATMOSPHERE_BY_ID[settings.atmosphereId] : null
  if (atm && withName) parts.push(atm.name)
  if (settings.weather) parts.push(settings.weather.mode === 'auto' ? 'live weather' : `themed ${WEATHER_WORD[settings.weather.mode]}`)
  if (settings.sky && settings.sky !== 'auto') parts.push(SKY_WORD[settings.sky] ?? settings.sky)
  if (settings.timer) parts.push(`${settings.timer.work}-min focus`)
  return parts.join(' · ')
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
