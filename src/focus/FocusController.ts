import { audioEngine } from '../audio/AudioEngine'
import { localDay, useRadioStore, type FocusState } from '../store/useRadioStore'
import { formatCountdown } from '../utils/time'

type FocusEngine = Pick<typeof audioEngine, 'chime' | 'setDuck'>

const BREAK_DUCK = 0.35
const BASE_TITLE = 'Pixel Radio'

/** Time left in the current phase (ms); 0 when idle. */
export function focusRemaining(focus: FocusState, now = Date.now()): number {
  if (focus.phase === 'idle') return 0
  if (focus.endsAt === null) return focus.pausedRemaining ?? 0
  return Math.max(0, focus.endsAt - now)
}

export const isPaused = (focus: FocusState) => focus.phase !== 'idle' && focus.endsAt === null

/**
 * Pomodoro clock. Phases are stored as wall-clock end times, so a throttled
 * background tab catches up on its next tick instead of drifting.
 */
export class FocusController {
  private engine: FocusEngine
  private now: () => number
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(engine: FocusEngine = audioEngine, now = () => Date.now()) {
    this.engine = engine
    this.now = now
  }

  connect() {
    this.timer = setInterval(this.tick, 500)
    this.applyDuck()
    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (next.focus.phase !== prev.focus.phase || next.focus.settings.duckOnBreak !== prev.focus.settings.duckOnBreak) {
        this.applyDuck()
      }
    })
    return () => {
      clearInterval(this.timer)
      unsubscribe()
      this.engine.setDuck(1)
      this.setTitle(null)
    }
  }

  private get focus() {
    return useRadioStore.getState().focus
  }

  private applyDuck() {
    const { phase, settings } = this.focus
    this.engine.setDuck(phase === 'break' && settings.duckOnBreak ? BREAK_DUCK : 1)
  }

  private setTitle(text: string | null) {
    if (typeof document !== 'undefined') document.title = text ? `${text} · ${BASE_TITLE}` : BASE_TITLE
  }

  private minutes(kind: 'work' | 'short' | 'long') {
    return this.focus.settings[kind] * 60_000
  }

  tick = () => {
    const focus = this.focus
    if (focus.phase !== 'idle' && focus.endsAt !== null && focus.endsAt <= this.now()) this.advance(true)
    const after = this.focus
    if (after.phase === 'idle') {
      this.setTitle(null)
    } else {
      const icon = isPaused(after) ? '❚❚' : after.phase === 'focus' ? '●' : '☕'
      this.setTitle(`${icon} ${formatCountdown(focusRemaining(after, this.now()))}`)
    }
  }

  /** Move to the next phase. Only a focus session that ran out counts as completed. */
  private advance(finished: boolean) {
    const state = useRadioStore.getState()
    const { focus } = state
    const today = localDay(new Date(this.now()))
    if (focus.phase === 'focus') {
      const completed = (focus.completedDay === today ? focus.completed : 0) + (finished ? 1 : 0)
      const long = completed > 0 && completed % focus.settings.longEvery === 0 && finished
      state.setFocus({
        phase: 'break',
        endsAt: this.now() + this.minutes(long ? 'long' : 'short'),
        pausedRemaining: null,
        longBreak: long,
        completed,
        completedDay: today,
      })
      if (finished) state.recordFocusSession()
      this.announce(finished ? 'Focus session done' : 'Focus session skipped', `Take ${long ? 'a long' : 'a short'} break.`, false)
    } else if (focus.phase === 'break') {
      state.setFocus({ phase: 'idle', endsAt: null, pausedRemaining: null })
      this.announce('Break over', 'Ready for the next focus session.', true)
    }
  }

  private announce(title: string, body: string, high: boolean) {
    const { settings } = this.focus
    if (settings.chime) this.engine.chime(high)
    if (
      settings.notify &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted' &&
      typeof document !== 'undefined' &&
      document.hidden
    ) {
      try {
        new Notification(title, { body, tag: 'pixel-radio-focus', silent: true })
      } catch {
        // Some platforms only allow notifications from a service worker
      }
    }
  }

  start = () => {
    const state = useRadioStore.getState()
    const today = localDay(new Date(this.now()))
    state.setFocus({
      phase: 'focus',
      endsAt: this.now() + this.minutes('work'),
      pausedRemaining: null,
      ...(state.focus.completedDay !== today ? { completed: 0, completedDay: today } : {}),
    })
    this.tick()
  }

  pause = () => {
    const focus = this.focus
    if (focus.phase === 'idle' || focus.endsAt === null) return
    useRadioStore.getState().setFocus({ endsAt: null, pausedRemaining: Math.max(0, focus.endsAt - this.now()) })
    this.tick()
  }

  resume = () => {
    const focus = this.focus
    if (!isPaused(focus)) return
    useRadioStore.getState().setFocus({ endsAt: this.now() + (focus.pausedRemaining ?? 0), pausedRemaining: null })
    this.tick()
  }

  /** Start when idle, otherwise pause/resume. */
  toggle = () => {
    const focus = this.focus
    if (focus.phase === 'idle') this.start()
    else if (isPaused(focus)) this.resume()
    else this.pause()
  }

  skip = () => {
    if (this.focus.phase === 'idle') return
    this.advance(false)
    this.tick()
  }

  reset = () => {
    useRadioStore.getState().setFocus({ phase: 'idle', endsAt: null, pausedRemaining: null })
    this.tick()
  }

  toggleMode = () => {
    const state = useRadioStore.getState()
    state.setFocus({ mode: !state.focus.mode })
    if (!state.focus.mode) state.setDrawer(null)
  }
}

export const focusController = new FocusController()
