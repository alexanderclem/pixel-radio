import { useEffect, useState } from 'react'
import { focusController, focusRemaining } from '../focus/FocusController'
import { useRadioStore } from '../store/useRadioStore'

/** React owns the timer's lifetime; the controller owns the clock. */
export function useFocusTimer() {
  useEffect(() => focusController.connect(), [])
  return focusController
}

/** Re-renders a few times a second while a phase is running and returns the time left (ms). */
export function useFocusRemaining() {
  const focus = useRadioStore((s) => s.focus)
  const running = focus.phase !== 'idle' && focus.endsAt !== null
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setTick((n) => n + 1), 250)
    return () => window.clearInterval(id)
  }, [running])
  return focus.phase === 'idle' ? focus.settings.work * 60_000 : focusRemaining(focus)
}
