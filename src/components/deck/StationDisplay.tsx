import { RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CITY_BY_ID } from '../../constants/cities'
import { PHASE_LABEL } from '../../constants/palettes'
import { useRadioStore } from '../../store/useRadioStore'
import { localTimeAt, stationFreq } from '../../utils/time'

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** Scrolls its text back and forth only when it overflows the LCD. */
function Marquee({ text }: { text: string }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (o && i) setShift(Math.min(0, o.clientWidth - i.scrollWidth))
  }, [text])
  return (
    <div ref={outer} className="overflow-hidden whitespace-nowrap">
      <span
        ref={inner}
        className={`inline-block ${shift < 0 ? 'marquee' : ''}`}
        style={{ ['--marquee-shift' as string]: `${shift}px` }}
      >
        {text}
      </span>
    </div>
  )
}

/** Green LCD readout: frequency, city, station, signal state, local time & solar phase. */
export function StationDisplay({ onStep }: { onStep: (delta: number) => void }) {
  const selectedCityId = useRadioStore((s) => s.selectedCityId)
  const station = useRadioStore((s) => s.station)
  const stations = useRadioStore((s) => s.stations)
  const stationIndex = useRadioStore((s) => s.stationIndex)
  const tuneStatus = useRadioStore((s) => s.tuneStatus)
  const statusText = useRadioStore((s) => s.statusText)
  const analyzed = useRadioStore((s) => s.analyzed)
  const phase = useRadioStore((s) => s.activePhase)
  const powered = useRadioStore((s) => s.powered)
  const retryTune = useRadioStore((s) => s.retryTune)
  const request = useRadioStore((s) => s.stationRequest)
  const now = useNow()

  const city = selectedCityId ? CITY_BY_ID[selectedCityId] : null
  // While tuning a map station, show it before the stream locks
  const shown = station ?? (!city && tuneStatus === 'tuning' ? request?.station : null) ?? null
  const freq = city ? city.freq : shown ? stationFreq(shown) : null
  const place = city
    ? `${city.name} · ${city.countryCode}`
    : shown
      ? `${shown.approx ? '~' : ''}${shown.location}`
      : 'TUNE ANY DOT ON THE MAP'
  const clock = city
    ? localTimeAt(city.lon, city.lat, true, now, city.timeZone)
    : shown?.lat != null && shown.lon != null
      ? localTimeAt(shown.lon, shown.lat, true, now)
      : '--:--:--'

  const statusColor =
    tuneStatus === 'playing' ? 'text-lcd' : tuneStatus === 'error' ? 'text-hot' : tuneStatus === 'tuning' ? 'text-glow' : 'text-lcd-dim'

  return (
    <div className="flex items-stretch gap-1.5">
      <div className="lcd min-w-0 flex-1 rounded-[3px] px-3 py-2 font-term text-lcd">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <span className="glow-text text-[34px] leading-none tabular-nums">
              {powered && freq !== null ? freq.toFixed(1) : '---.-'}
            </span>
            <span className="text-[16px] leading-none text-lcd-dim">MHz</span>
          </div>
          <div className="text-right text-[16px] leading-tight">
            <div className="glow-text tabular-nums">{powered ? clock : '--:--:--'}</div>
            <div className="text-lcd-dim">{powered ? PHASE_LABEL[phase] : 'STANDBY'}</div>
          </div>
        </div>
        <div className="mt-1 truncate text-[20px] leading-tight uppercase">
          {powered ? place : 'PIXEL RADIO'}
        </div>
        <div className="glow-text text-[22px] leading-tight">
          <Marquee text={powered ? (station?.name ?? (tuneStatus === 'tuning' && shown ? shown.name : statusText)) : 'PRESS POWER'} />
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[15px] leading-none">
          <span role="status" aria-live="polite" aria-atomic="true" className={`${statusColor} ${tuneStatus === 'tuning' ? 'blink' : ''} truncate`}>
            {tuneStatus === 'playing' ? '● ' : tuneStatus === 'error' ? '✕ ' : '◌ '}
            {powered ? statusText : 'OFF'}
          </span>
          <span className="shrink-0 text-lcd-dim tabular-nums">
            {station ? `${station.codec}${station.bitrate ? ` ${station.bitrate}K` : ''}` : ''}
            {station && !analyzed ? (
              <span title="This server sends no CORS headers, so the stream plays directly and bypasses the filter and analyser">
                {' '}
                · DIRECT
              </span>
            ) : (
              ''
            )}
            {stations.length > 0 && stationIndex >= 0 ? ` · ${stationIndex + 1}/${stations.length}` : ''}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {powered && tuneStatus === 'error' && (
          <button
            type="button"
            onClick={retryTune}
            aria-label="Retry playback"
            title="Retry playback"
            className="grid min-h-9 place-items-center rounded-[3px] border border-black bg-amber-400 px-2 text-black focus-visible:ring-2 focus-visible:ring-white"
          >
            <RotateCcw size={15} />
          </button>
        )}
        {[
          { label: 'Previous station', icon: SkipBack, delta: -1 },
          { label: 'Next station', icon: SkipForward, delta: 1 },
        ].map(({ label, icon: Icon, delta }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            disabled={!powered || stations.length === 0}
            onClick={() => onStep(delta)}
            className="grid flex-1 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2 text-zinc-200 shadow-[0_2px_0_#000] transition hover:text-amber-300 active:translate-y-0.5 active:shadow-none disabled:opacity-40"
          >
            <Icon size={15} fill="currentColor" />
          </button>
        ))}
      </div>
    </div>
  )
}
