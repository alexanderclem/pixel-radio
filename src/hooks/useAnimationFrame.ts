import { useEffect, useRef } from 'react'

/** Calls `callback(dt, time)` every animation frame; dt in seconds, clamped for tab switches. */
export function useAnimationFrame(callback: (dt: number, time: number) => void, active = true) {
  const cb = useRef(callback)
  useEffect(() => {
    cb.current = callback
  })

  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      cb.current(dt, now / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])
}
