import { useEffect } from 'react'
import { PassportTracker } from '../progress/track'

const TICK_MS = 15_000

/** Keeps the passport up to date while the radio plays. */
export function useProgress() {
  useEffect(() => {
    const tracker = new PassportTracker()
    tracker.tick()
    const id = window.setInterval(() => tracker.tick(), TICK_MS)
    return () => window.clearInterval(id)
  }, [])
}
