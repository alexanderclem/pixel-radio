import { useEffect } from 'react'
import { MIX_KEYS } from '../session/setup'
import { currentSetup } from '../session/play'
import { useRadioStore } from '../store/useRadioStore'

type State = ReturnType<typeof useRadioStore.getState>

const SAVE_DELAY_MS = 5000

/** What the last session is made of; a change to any of it is worth saving. */
const sessionKey = (s: State) =>
  s.tuneStatus === 'playing' && s.station
    ? JSON.stringify([s.station.id, s.weather, s.solarOverride, s.ambientLinked, s.atmosphere?.id, s.focus.phase, MIX_KEYS.map((k) => s.audio[k])])
    : null

/** Remembers the playing station and its mood, a few seconds after it settles, for Resume. */
export function useSessionMemory() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      const key = sessionKey(next)
      if (!key || key === sessionKey(prev)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const setup = currentSetup()
        if (setup) useRadioStore.getState().setLastSession({ ...setup, savedAt: Date.now() })
      }, SAVE_DELAY_MS)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [])
}
