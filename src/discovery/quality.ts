import type { Station } from '../types'
import { oftenOffline, reliabilityOf, type Reliability } from './reliability'

export interface Badge {
  label: string
  tone: 'good' | 'warn' | 'dim'
  title: string
}

const LOSSLESS = /flac|alac|wav|pcm/i
/** Opus and AAC sound fine at lower bitrates than MP3 */
const EFFICIENT = /opus|aac|he-aac/i

/** Short labels for what a listener can expect from a stream. */
export function qualityBadges(station: Station, reliability: Reliability | null = reliabilityOf(station.id)): Badge[] {
  const badges: Badge[] = []
  const kbps = typeof station.bitrate === 'number' ? station.bitrate : 0
  const efficient = EFFICIENT.test(station.codec)
  if (LOSSLESS.test(station.codec)) badges.push({ label: 'LOSSLESS', tone: 'good', title: `${station.codec}, lossless` })
  else if (kbps >= 192 || (efficient && kbps >= 128)) badges.push({ label: 'HQ', tone: 'good', title: `${station.codec} ${kbps} kbps` })
  else if (kbps > 0 && kbps < (efficient ? 48 : 64)) badges.push({ label: 'LOW', tone: 'warn', title: `Low bitrate: ${station.codec} ${kbps} kbps` })
  if (station.relay) badges.push({ label: 'RELAY', tone: 'dim', title: 'Plain-http stream, played through the Pixel Radio relay' })
  if (oftenOffline(reliability)) badges.push({ label: 'OFTEN OFFLINE', tone: 'warn', title: "Didn't answer the last times it was tried on this device" })
  return badges
}

/** How much to favour a station when ranking suggestions: popular, sounds good, answers. */
export function qualityScore(station: Station, reliability: Reliability | null = reliabilityOf(station.id)): number {
  const kbps = typeof station.bitrate === 'number' ? station.bitrate : 0
  let score = Math.log10(1 + Math.max(0, station.popularity)) + 0.5 * Math.log10(1 + Math.max(0, station.votes ?? 0))
  if (kbps >= 128 || EFFICIENT.test(station.codec)) score += 0.5
  else if (kbps > 0 && kbps < 64) score -= 0.5
  if (station.url.startsWith('https://')) score += 0.3
  if (station.lat !== null) score += 0.2
  if (oftenOffline(reliability)) score -= 3
  else if (reliability?.last) score += 0.5
  return score
}
