import type { FriendInfo } from './protocol'

/** "Focusing · 18m left", "On a break · 3m", the station they're on, or offline. */
export function friendStatus(f: FriendInfo, receivedAt: number | undefined, now: number) {
  if (!f.online) return 'offline'
  const parts: string[] = []
  const focus = f.presence?.focus
  if (focus) {
    // The panel's clock may lag the update it is showing, so never count time backwards
    const left = focus.paused ? focus.remainingMs : focus.remainingMs - Math.max(0, now - (receivedAt ?? now))
    const mins = Math.max(0, Math.ceil(left / 60_000))
    if (focus.phase === 'focus') parts.push(focus.paused ? 'Focus paused' : `Focusing · ${mins}m left`)
    else parts.push(focus.paused ? 'Break paused' : `On a break · ${mins}m`)
  }
  const station = f.presence?.station
  if (station) parts.push(`♪ ${station.name}`)
  return parts.join(' · ') || 'online'
}
