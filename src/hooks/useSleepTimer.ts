import { useEffect, useState } from 'react'
import { audioEngine } from '../audio/AudioEngine'
import { SleepController, sleepRemaining } from '../sleep/SleepController'
import { useRadioStore } from '../store/useRadioStore'
import { radio } from './useAudioEngine'

export const sleepController = new SleepController(audioEngine, () => radio.powerOff())

/** React owns the timer's lifetime; the controller owns the clock. */
export function useSleepTimer() {
  useEffect(() => sleepController.connect(), [])
}

/** Time left before the radio turns off (ms), re-rendering each second; null when not counting down. */
export function useSleepRemaining() {
  const sleep = useRadioStore((s) => s.sleep)
  const counting = sleep.mode !== 'off' && sleep.endsAt !== null
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!counting) return
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [counting])
  return sleepRemaining(sleep)
}
