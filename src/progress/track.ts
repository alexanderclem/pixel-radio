import { useRadioStore } from '../store/useRadioStore'
import { creditListening, recordFocus, recordRide, totals, type Rides } from './progress'
import { newlyEarned, unlockLabel } from './unlocks'

/** Longest gap credited between two ticks (a throttled background tab still counts, a sleeping laptop doesn't) */
const MAX_STEP_MS = 70_000

const regionName = (code: string) => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

/** Announce avatar parts that just became wearable. */
export function celebrate() {
  const s = useRadioStore.getState()
  const fresh = newlyEarned(totals(s.progress), s.progress.celebrated)
  if (!fresh.length) return
  s.setProgress({ ...s.progress, celebrated: [...s.progress.celebrated, ...fresh.map((p) => p.key)] })
  s.showToast(`Unlocked for your avatar: ${fresh.map((p) => p.name).join(', ')} (${unlockLabel(fresh[0].unlock).toLowerCase()})`)
}

/** A finished focus session: with friends if you're in a room with others or a friend is focusing too. */
export function logFocus(minutes: number) {
  const s = useRadioStore.getState()
  const together = (s.room?.members.length ?? 0) > 1 || s.friends.list.some((f) => f.online && f.presence?.focus?.phase === 'focus')
  s.setProgress(recordFocus(s.progress, minutes, together))
  celebrate()
}

/** Your avatar set off by boat, plane or balloon. */
export function logRide(mode: keyof Rides) {
  const s = useRadioStore.getState()
  s.setProgress(recordRide(s.progress, mode))
  celebrate()
}

/** Credits listening time to the playing station; two minutes on one earns its passport stamp. */
export class PassportTracker {
  private stationId: string | null = null
  private heardMs = 0
  private last = 0

  tick(now = Date.now()) {
    const s = useRadioStore.getState()
    const st = s.powered && s.tuneStatus === 'playing' ? s.station : null
    if (!st || st.id !== this.stationId) {
      this.stationId = st?.id ?? null
      this.heardMs = 0
      this.last = now
      return
    }
    const add = Math.max(0, Math.min(MAX_STEP_MS, now - this.last))
    this.last = now
    this.heardMs += add
    const { progress, stamped } = creditListening(s.progress, st, add, this.heardMs, now)
    if (progress === s.progress) return
    s.setProgress(progress)
    if (stamped === 'country') s.showToast(`New passport stamp: ${regionName(st.country)}`)
    if (stamped) celebrate()
  }
}
