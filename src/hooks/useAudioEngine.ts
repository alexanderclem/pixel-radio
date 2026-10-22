import { useEffect } from 'react'
import { RadioController } from '../audio/RadioController'

const controller = new RadioController()

/** React owns the subscription lifetime; the controller owns audio operations. */
export function useAudioEngine() {
  useEffect(() => controller.connect(), [])
  return {
    powerOn: controller.powerOn,
    powerOff: controller.powerOff,
    stepStation: controller.stepStation,
  }
}
