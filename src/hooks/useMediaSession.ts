import { useEffect } from 'react'
import { useRadioStore } from '../store/useRadioStore'
import { radio } from './useAudioEngine'

type Action = MediaSessionAction

/**
 * Lock-screen, headset and keyboard media keys: pause stops the radio stream (ambience
 * keeps going) and play reconnects it, stop powers off, next/previous step through nearby
 * stations. NowPlaying sets the metadata.
 */
export function useMediaSession() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const handlers: [Action, MediaSessionActionHandler][] = [
      ['play', () => (useRadioStore.getState().powered ? radio.resume() : void radio.powerOn())],
      // Pause stops the radio and keeps the mood and ambience, like the display's button
      ['pause', () => radio.pause()],
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
      session.playbackState = !s.powered ? 'none' : s.tuneStatus === 'error' || s.tuneStatus === 'paused' ? 'paused' : 'playing'
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
