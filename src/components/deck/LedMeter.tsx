import { useRef } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { useAnimationFrame } from '../../hooks/useAnimationFrame'

const SEGMENTS = 24
const W = SEGMENTS * 4
const H = 9

const segColor = (i: number) => (i >= SEGMENTS - 3 ? '#ff4d6d' : i >= SEGMENTS - 8 ? '#ffb347' : '#7dffa8')

/** Stereo LED VU meter (RMS, dBFS scale) with falling peak hold. */
export function LedMeter({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef({ l: 0, r: 0, pl: 0, pr: 0 })

  useAnimationFrame((dt) => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const s = state.current
    const { left, right } = active ? audioEngine.getLevels() : { left: 0, right: 0 }
    const toUnit = (rms: number) => Math.max(0, (20 * Math.log10(rms + 1e-6) + 48) / 48)
    // Fast attack, slower release like a real VU ballistics curve
    const ballistics = (cur: number, next: number) => (next > cur ? next : cur - dt * 1.4)
    s.l = ballistics(s.l, toUnit(left))
    s.r = ballistics(s.r, toUnit(right))
    s.pl = Math.max(s.l, s.pl - dt * 0.35)
    s.pr = Math.max(s.r, s.pr - dt * 0.35)

    ctx.fillStyle = '#050806'
    ctx.fillRect(0, 0, W, H)
    const row = (y: number, level: number, peak: number) => {
      const lit = Math.round(level * SEGMENTS)
      const pk = Math.min(SEGMENTS - 1, Math.round(peak * SEGMENTS))
      for (let i = 0; i < SEGMENTS; i++) {
        ctx.globalAlpha = i < lit || (i === pk && peak > 0.02) ? 1 : 0.13
        ctx.fillStyle = segColor(i)
        ctx.fillRect(i * 4, y, 3, 3)
      }
      ctx.globalAlpha = 1
    }
    row(1, s.l, s.pl)
    row(5, s.r, s.pr)
  })

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col font-term text-[10px] leading-[11px] text-zinc-500">
        <span>L</span>
        <span>R</span>
      </div>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        aria-label="Output level meter"
        role="img"
        className="pixelated h-[22px] w-full min-w-0 flex-1"
      />
    </div>
  )
}
