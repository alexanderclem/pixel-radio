import { useEffect } from 'react'
import { RadioController } from '../audio/RadioController'

const controller = new RadioController()

/** The one radio controller, for flows that start playback outside React (setups, sessions). */
export const radio = controller

/** React owns the subscription lifetime; the controller owns audio operations. */
export function useAudioEngine() {
  useEffect(() => controller.connect(), [])
  return {
    powerOn: () => controller.powerOn(),
    powerOff: controller.powerOff,
    stepStation: controller.stepStation,
  }
}
