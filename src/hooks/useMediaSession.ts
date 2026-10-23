import { useEffect } from 'react'
import { useRadioStore } from '../store/useRadioStore'
import { radio } from './useAudioEngine'

type Action = MediaSessionAction

/**
 * Lock-screen, headset and keyboard media keys. Live radio can't pause, so pause and
 * stop power off; next/previous step through nearby stations. NowPlaying sets the metadata.
 */
export function useMediaSession() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const handlers: [Action, MediaSessionActionHandler][] = [
      ['play', () => void radio.powerOn()],
      ['pause', () => void radio.powerOff()],
      ['stop', () => void radio.powerOff()],
      ['nexttrack', () => void radio.stepStation(1)],
      ['previoustrack', () => void radio.stepStation(-1)],
    ]
    const set = (action: Action, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler)
      } catch {
        // This browser doesn't support that action
      }
    }
    for (const [action, handler] of handlers) set(action, handler)
    const state = () => {
      const s = useRadioStore.getState()
      session.playbackState = s.powered ? (s.tuneStatus === 'error' ? 'paused' : 'playing') : 'none'
    }
    state()
    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (next.powered !== prev.powered || next.tuneStatus !== prev.tuneStatus) state()
    })
    return () => {
      unsubscribe()
      for (const [action] of handlers) set(action, null)
    }
  }, [])
}
