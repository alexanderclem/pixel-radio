import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { clamp } from '../../utils/math'

interface FaderProps {
  label: string
  value: number
  onChange: (value: number) => void
  /** Optional 0..1 reading for the "GEO" LED column (camera-driven mix). */
  geo?: number
  accent?: string
}

const SEGMENTS = 8

/** Vertical channel fader with an optional LED column showing the geographic blend. */
export function Fader({ label, value, onChange, geo, accent = '#ffb347' }: FaderProps) {
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const valueFromPointer = (clientY: number) => {
    const rect = track.current!.getBoundingClientRect()
    return clamp(1 - (clientY - rect.top - 8) / (rect.height - 16), 0, 1)
  }

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    onChange(valueFromPointer(e.clientY))
  }
  const onPointerMove = (e: PointerEvent) => {
    if (dragging.current) onChange(valueFromPointer(e.clientY))
  }
  const onPointerUp = () => {
    dragging.current = false
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.03
    const keys: Record<string, number> = {
      ArrowUp: value + step, ArrowRight: value + step, ArrowDown: value - step, ArrowLeft: value - step,
      Home: 0, End: 1,
    }
    if (e.key in keys) {
      e.preventDefault()
      onChange(clamp(keys[e.key], 0, 1))
    }
  }

  const lit = geo === undefined ? 0 : Math.round(geo * SEGMENTS)

  return (
    <div className="flex flex-col items-center gap-1.5 select-none">
      <div className="flex h-32 items-stretch gap-1.5">
        {geo !== undefined && (
          <div className="flex flex-col-reverse justify-between py-2" aria-hidden>
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <span
                key={i}
                className="block h-1.5 w-1.5 transition-colors duration-200"
                style={{
                  background: i < lit ? '#7dffa8' : '#14301e',
                  boxShadow: i < lit ? '0 0 4px #7dffa8' : 'none',
                }}
              />
            ))}
          </div>
        )}
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(value * 100)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="relative w-8 cursor-ns-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
        >
          {/* Tick marks */}
          <div className="absolute inset-y-2 left-0 flex flex-col justify-between" aria-hidden>
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} className={`block h-px bg-zinc-500/60 ${i % 5 === 0 ? 'w-2' : 'w-1'}`} />
            ))}
          </div>
          {/* Slot */}
          <div className="absolute inset-y-1 left-1/2 w-1.5 -translate-x-1/2 rounded-full bg-black shadow-[inset_0_1px_2px_#000,0_1px_0_rgb(255_255_255/0.06)]" />
          <div
            className="absolute bottom-2 left-1/2 w-0.5 -translate-x-1/2"
            style={{ height: `calc((100% - 16px) * ${value})`, background: accent, boxShadow: `0 0 6px ${accent}` }}
          />
          {/* Cap */}
          <div
            className="absolute left-1/2 h-4 w-7 -translate-x-1/2 rounded-[2px] border border-black bg-gradient-to-b from-zinc-300 via-zinc-500 to-zinc-700 shadow-[0_2px_3px_rgb(0_0_0/0.6)]"
            style={{ bottom: `calc((100% - 16px) * ${value})` }}
          >
            <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-black/70" />
          </div>
        </div>
      </div>
      <span className="engraved font-term text-[13px] leading-none uppercase">{label}</span>
    </div>
  )
}
