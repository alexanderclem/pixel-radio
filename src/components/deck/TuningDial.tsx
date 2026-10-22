import { ChevronLeft, ChevronRight } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { audioEngine } from '../../audio/AudioEngine'
import { CITIES, CITIES_BY_FREQ, CITY_BY_ID, FM_MAX, FM_MIN } from '../../constants/cities'
import { useRadioStore } from '../../store/useRadioStore'
import { clamp } from '../../utils/math'
import { stationFreq } from '../../utils/time'

const pct = (freq: number) => ((freq - FM_MIN) / (FM_MAX - FM_MIN)) * 100

const nearestByFreq = (freq: number) =>
  CITIES.reduce((best, c) => (Math.abs(c.freq - freq) < Math.abs(best.freq - freq) ? c : best))

/**
 * Analogue FM strip. Drag the needle to sweep through static between stations; releasing
 * snaps to the nearest city. Arrows step through cities in dial order.
 */
export function TuningDial() {
  const selectedCityId = useRadioStore((s) => s.selectedCityId)
  const tuneStatus = useRadioStore((s) => s.tuneStatus)
  const powered = useRadioStore((s) => s.powered)
  const station = useRadioStore((s) => s.station)
  const selectCity = useRadioStore((s) => s.selectCity)
  const strip = useRef<HTMLDivElement>(null)
  const [dragFreq, setDragFreq] = useState<number | null>(null)

  const selected = selectedCityId ? CITY_BY_ID[selectedCityId] : null
  const freq = dragFreq ?? selected?.freq ?? (station ? stationFreq(station) : 100)

  const freqFromPointer = (clientX: number) => {
    const rect = strip.current!.getBoundingClientRect()
    return FM_MIN + clamp((clientX - rect.left) / rect.width, 0, 1) * (FM_MAX - FM_MIN)
  }

  const sweep = (f: number) => {
    setDragFreq(f)
    const offset = Math.abs(nearestByFreq(f).freq - f)
    audioEngine.setScanNoise(clamp(offset / 0.45, 0, 1))
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!powered) return
    e.currentTarget.setPointerCapture(e.pointerId)
    sweep(freqFromPointer(e.clientX))
  }
  const onPointerMove = (e: PointerEvent) => {
    if (dragFreq !== null) sweep(freqFromPointer(e.clientX))
  }
  const onPointerUp = () => {
    if (dragFreq === null) return
    audioEngine.setScanNoise(0)
    const city = nearestByFreq(dragFreq)
    setDragFreq(null)
    selectCity(city.id)
  }

  const step = (dir: number) => {
    const idx = CITIES_BY_FREQ.findIndex((c) => c.id === selectedCityId)
    const next = CITIES_BY_FREQ[(idx + dir + CITIES_BY_FREQ.length) % CITIES_BY_FREQ.length]
    selectCity(next.id)
  }

  const ticks = []
  for (let f = 88; f <= 108; f += 0.5) ticks.push(f)

  return (
    <div className="flex items-stretch gap-1.5">
      <DialButton label="Previous city" onClick={() => step(-1)} disabled={!powered}>
        <ChevronLeft size={16} strokeWidth={3} />
      </DialButton>
      <div
        ref={strip}
        role="slider"
        aria-label="FM tuning dial"
        aria-valuemin={FM_MIN}
        aria-valuemax={FM_MAX}
        aria-valuenow={Number(freq.toFixed(1))}
        aria-valuetext={`${freq.toFixed(1)} megahertz${selected ? `, ${selected.name}` : ''}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1)
          if (e.key === 'ArrowRight') step(1)
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative h-14 flex-1 cursor-ew-resize touch-none overflow-hidden rounded-[3px] bg-gradient-to-b from-[#f3e6c4] to-[#d9c79a] shadow-[inset_0_2px_6px_rgb(0_0_0/0.5)] outline-none select-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
      >
        {/* Backlight warmth */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,rgb(255_170_60/0.35),transparent_70%)]" />
        {ticks.map((f) => {
          const major = f % 2 === 0
          return (
            <div key={f} className="absolute top-0" style={{ left: `${pct(f)}%` }}>
              <div className={`w-px bg-zinc-800 ${major ? 'h-3' : 'h-1.5'}`} />
              {major && (
                <span className="absolute top-3 -translate-x-1/2 font-term text-[11px] leading-none text-zinc-800">{f}</span>
              )}
            </div>
          )
        })}
        {CITIES.map((c) => (
          <div key={c.id} className="absolute bottom-1 -translate-x-1/2" style={{ left: `${pct(c.freq)}%` }}>
            <span
              className={`block font-term text-[11px] leading-none ${c.id === selectedCityId ? 'text-red-700' : 'text-zinc-600'}`}
            >
              {c.code}
            </span>
          </div>
        ))}
        <motion.div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-600 shadow-[0_0_6px_rgb(220_38_38/0.9)]"
          initial={false}
          animate={{
            left: `${pct(freq)}%`,
            x: tuneStatus === 'tuning' && dragFreq === null ? [0, -2, 2, -1, 1, 0] : 0,
          }}
          transition={{
            left: dragFreq !== null ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 14 },
            x: { duration: 0.35, repeat: tuneStatus === 'tuning' ? Infinity : 0 },
          }}
        />
      </div>
      <DialButton label="Next city" onClick={() => step(1)} disabled={!powered}>
        <ChevronRight size={16} strokeWidth={3} />
      </DialButton>
    </div>
  )
}

function DialButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid w-7 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 text-zinc-200 shadow-[0_2px_0_#000] transition hover:text-amber-300 active:translate-y-0.5 active:shadow-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}
