import { audioEngine } from '../audio/AudioEngine'
import { useRadioStore, type SleepState } from '../store/useRadioStore'

type SleepEngine = Pick<typeof audioEngine, 'setFade'>
type PowerOff = () => unknown

const MIN = 60_000
/** The longest fade, for long timers; short ones fade over their last third */
const MAX_FADE_MS = 5 * MIN
/** After a focus session ends */
const FOCUS_END_FADE_MS = 30_000
const OFF: SleepState = { mode: 'off', endsAt: null, fadeMs: 0 }

export const SLEEP_MINUTES = [15, 30, 45, 60, 90]

/** Time left before the radio turns off (ms); null when off or waiting for the focus session. */
export function sleepRemaining(sleep: SleepState, now = Date.now()): number | null {
  return sleep.mode === 'off' || sleep.endsAt === null ? null : Math.max(0, sleep.endsAt - now)
}

/**
 * Sleep timer: turns the radio off at a wall-clock time, fading the whole mix out first,
 * or does the same once the current focus session ends. The fade never changes the saved
 * volume; turning the volume during the fade cancels the timer.
 */
export class SleepController {
  private engine: SleepEngine
  private powerOff: PowerOff
  private now: () => number
  private timer: ReturnType<typeof setInterval> | undefined
  private level = 1

  constructor(engine: SleepEngine = audioEngine, powerOff: PowerOff = () => {}, now = () => Date.now()) {
    this.engine = engine
    this.powerOff = powerOff
    this.now = now
  }

  connect() {
    this.timer = setInterval(this.tick, 500)
    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      const { sleep } = next
      if (sleep.mode === 'off') return
      if (!next.powered && prev.powered) {
        // Turned off by hand (or by us): nothing left to put to sleep
        this.clear()
        return
      }
      if (next.audio.master !== prev.audio.master && this.level < 1) {
        this.clear()
        next.showToast('Sleep timer off: you changed the volume')
        return
      }
      const ended =
        prev.focus.phase === 'focus' && next.focus.phase === 'break' &&
        // Solo sessions count as finished only when they're logged (skipping isn't finishing);
        // in a study room the server moves the phase and logs separately
        (next.room?.study === true || next.focus.completed > prev.focus.completed)
      if (sleep.mode === 'focus-end' && sleep.endsAt === null && ended) {
        next.setSleep({ ...sleep, endsAt: this.now() + FOCUS_END_FADE_MS, fadeMs: FOCUS_END_FADE_MS })
        next.showToast('Focus session done · the radio fades out in 30 s')
      }
    })
    return () => {
      clearInterval(this.timer)
      unsubscribe()
      this.setLevel(1)
    }
  }

  private setLevel(level: number) {
    if (Math.abs(level - this.level) < 0.002 && (level !== 1 || this.level === 1)) return
    this.level = level
    this.engine.setFade(level)
  }

  private clear() {
    useRadioStore.getState().setSleep(OFF)
    this.setLevel(1)
  }

  tick = () => {
    const state = useRadioStore.getState()
    const left = sleepRemaining(state.sleep, this.now())
    if (left === null) {
      this.setLevel(1)
      return
    }
    if (left <= 0) {
      state.setSleep(OFF)
      this.setLevel(0)
      void Promise.resolve(this.powerOff()).finally(() => this.setLevel(1))
      return
    }
    const fadeMs = state.sleep.fadeMs
    // Squared, like the volume knob, so the fade sounds even rather than dropping at the end
    const r = fadeMs > 0 && left < fadeMs ? left / fadeMs : 1
    this.setLevel(r * r)
  }

  /** Turn off after `minutes`. */
  start = (minutes: number) => {
    const ms = minutes * MIN
    useRadioStore.getState().setSleep({ mode: 'timer', endsAt: this.now() + ms, fadeMs: Math.min(MAX_FADE_MS, ms / 3) })
    this.tick()
  }

  /** Turn off when the focus session that's running (or the next one) ends. */
  atFocusEnd = () => {
    useRadioStore.getState().setSleep({ mode: 'focus-end', endsAt: null, fadeMs: FOCUS_END_FADE_MS })
    this.tick()
  }

  cancel = () => this.clear()
}
