import { findMood } from '../session/moods'
import { playAtmosphere } from '../session/play'
import type { Atmosphere } from '../session/atmospheres'
import { localDay, useRadioStore, type MoodSchedule } from '../store/useRadioStore'
import { notify } from '../utils/notify'

/** A schedule still goes off if the app opens (or wakes) up to this long after its time. */
const GRACE_MIN = 30
const CHECK_MS = 20_000

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** "Weekdays", "Every day", "Sat, Sun". */
export function daysLabel(days: number[]): string {
  const set = new Set(days)
  if (!set.size || set.size === 7) return 'Every day'
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Weekdays'
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends'
  // Monday first
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => set.has(d)).map((d) => DAY_LABELS[d]).join(', ')
}

/** Schedules that should go off now: on today, past their time but within the grace, not yet today. */
export function dueSchedules(list: MoodSchedule[], now: Date): MoodSchedule[] {
  const today = localDay(now)
  const minute = now.getHours() * 60 + now.getMinutes()
  return list.filter((s) => {
    if (!s.enabled || s.lastFired === today) return false
    if (s.days.length && !s.days.includes(now.getDay())) return false
    const late = minute - minutesOf(s.time)
    return late >= 0 && late < GRACE_MIN
  })
}

type Start = (atm: Atmosphere) => Promise<unknown>

/** Browsers start audio without a click only once the page has had one. */
const hadClick = () => typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true

/**
 * Plays scheduled moods while Pixel Radio is open. When the browser won't start audio on
 * its own, the mood waits on the first screen (and in a notification) for one click.
 */
export class ScheduleController {
  private start: Start
  private canStart: () => boolean
  private now: () => Date
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(start: Start = (atm) => playAtmosphere(atm), canStart = hadClick, now = () => new Date()) {
    this.start = start
    this.canStart = canStart
    this.now = now
  }

  connect() {
    this.timer = setInterval(() => void this.tick(), CHECK_MS)
    void this.tick()
    // A tab coming back from the background catches up straight away
    const wake = () => document.visibilityState === 'visible' && void this.tick()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake)
    return () => {
      clearInterval(this.timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake)
    }
  }

  tick = async () => {
    const now = this.now()
    for (const schedule of dueSchedules(useRadioStore.getState().schedules, now)) {
      useRadioStore.getState().saveSchedule({ ...schedule, lastFired: localDay(now) })
      await this.fire(schedule)
    }
  }

  private async fire(schedule: MoodSchedule) {
    const s = useRadioStore.getState()
    const atm = findMood(schedule.moodId)
    if (!atm) {
      s.showToast('A scheduled mood was deleted, so it was skipped')
      return
    }
    if (s.powered && s.atmosphere?.id === atm.id) return
    if (s.powered || this.canStart()) {
      try {
        await this.start(atm)
        useRadioStore.getState().showToast(`Scheduled: ${atm.name}`)
        return
      } catch {
        // Audio wouldn't start without a click: fall through and ask for one
      }
    }
    useRadioStore.getState().setScheduleReady({ moodId: atm.id, name: atm.name })
    void notify(`${atm.name} is ready`, { body: 'Click to start listening.', tag: 'pixel-radio-schedule' })
  }
}

export const scheduleController = new ScheduleController()
