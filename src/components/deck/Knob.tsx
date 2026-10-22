import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { clamp } from '../../utils/math'

interface KnobProps {
  label: string
  value: number
  onChange: (value: number) => void
  defaultValue?: number
  format?: (value: number) => string
  size?: number
  accent?: string
}

const SWEEP = 270
const R = 40
const ARC = (2 * Math.PI * R * SWEEP) / 360

/**
 * Rotary pot: drag vertically (Shift for fine), scroll, or use arrow keys.
 * Double-click resets to the default.
 */
export function Knob({ label, value, onChange, defaultValue = 0.5, format, size = 56, accent = '#ffb347' }: KnobProps) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; v: number } | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
  })

  useEffect(() => {
    const el = ref.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      onChangeRef.current(clamp(valueRef.current - e.deltaY * 0.0012, 0, 1))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, v: value }
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return
    const range = e.shiftKey ? 700 : 170
    onChange(clamp(drag.current.v + (drag.current.y - e.clientY) / range, 0, 1))
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const keys: Record<string, number> = {
      ArrowUp: value + step, ArrowRight: value + step, ArrowDown: value - step, ArrowLeft: value - step,
      PageUp: value + 0.1, PageDown: value - 0.1, Home: 0, End: 1,
    }
    if (e.key in keys) {
      e.preventDefault()
      onChange(clamp(keys[e.key], 0, 1))
    }
  }

  const angle = -SWEEP / 2 + value * SWEEP
  const display = format ? format(value) : `${Math.round(value * 100)}`

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-valuetext={display}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => onChange(defaultValue)}
        onKeyDown={onKeyDown}
        className="cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
        style={{ width: size, height: size }}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
          <defs>
            <radialGradient id={`${id}-body`} cx="38%" cy="32%" r="75%">
              <stop offset="0%" stopColor="#5d5c66" />
              <stop offset="55%" stopColor="#2a2930" />
              <stop offset="100%" stopColor="#111014" />
            </radialGradient>
            <linearGradient id={`${id}-cap`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b3a43" />
              <stop offset="100%" stopColor="#1c1b21" />
            </linearGradient>
          </defs>
          <circle
            cx="50" cy="50" r={R} fill="none" stroke="#0a0a0d" strokeWidth="7"
            strokeDasharray={`${ARC} 999`} transform="rotate(135 50 50)" strokeLinecap="round"
          />
          <circle
            cx="50" cy="50" r={R} fill="none" stroke={accent} strokeWidth="4"
            strokeDasharray={`${ARC * value} 999`} transform="rotate(135 50 50)" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${accent})` }}
          />
          <g transform={`rotate(${angle} 50 50)`}>
            <circle cx="50" cy="50" r="31" fill={`url(#${id}-body)`} stroke="#000" strokeWidth="1.5" />
            {Array.from({ length: 20 }, (_, i) => (
              <line
                key={i} x1="50" y1="20.5" x2="50" y2="24" stroke="#000" strokeOpacity="0.55" strokeWidth="1.4"
                transform={`rotate(${i * 18} 50 50)`}
              />
            ))}
            <circle cx="50" cy="50" r="22" fill={`url(#${id}-cap)`} />
            <rect x="48" y="24" width="4" height="13" rx="1" fill="#f4f4f5" />
          </g>
        </svg>
      </div>
      <span className="engraved font-term text-[13px] leading-none uppercase">{label}</span>
      <span className="font-term text-[13px] leading-none text-amber-300/80 tabular-nums">{display}</span>
    </div>
  )
}
