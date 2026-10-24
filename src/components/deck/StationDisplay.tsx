import { Compass, Pause, Play, RotateCcw, SkipBack, SkipForward, Star } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CITY_BY_ID } from '../../constants/cities'
import { PHASE_LABEL } from '../../constants/palettes'
import { radio } from '../../hooks/useAudioEngine'
import { currentSong, useRadioStore, type TuneStatus } from '../../store/useRadioStore'
import { AtmosphereChip } from '../AtmosphereChip'
import { FallbackNotice } from '../FallbackNotice'
import { SaveSongButton } from '../HistoryPanel'
import { JourneyBar } from '../JourneyBar'
import { ShareMenu } from '../ShareMenu'
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

const GLYPH: Record<TuneStatus, string> = { idle: '○', tuning: '◌', playing: '●', paused: '❚❚', error: '✕' }
const STATE_LABEL: Record<TuneStatus, string> = { idle: 'Idle', tuning: 'Connecting', playing: 'Playing', paused: 'Paused', error: 'Not playing' }

/** The display's big button: pause what's on, play what was paused, or retry what failed. */
function mainAction(powered: boolean, status: TuneStatus, retry: () => void) {
  if (status === 'error') return { label: 'Retry playback', icon: RotateCcw, run: retry, disabled: false }
  if (status === 'paused') return { label: 'Play the radio', icon: Play, run: radio.resume, disabled: false }
  return { label: 'Pause the radio (ambience keeps playing)', icon: Pause, run: radio.pause, disabled: !powered || status === 'idle' }
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
  const locateActive = useRadioStore((s) => s.locateActive)
  const song = useRadioStore(currentSong)
  const toggleFavorite = useRadioStore((s) => s.toggleFavorite)
  const setDrawer = useRadioStore((s) => s.setDrawer)
  const favorite = useRadioStore((s) => (s.station ? s.library.favorites.some((f) => f.id === s.station!.id) : false))
  const now = useNow()

  const city = selectedCityId ? CITY_BY_ID[selectedCityId] : null
  // While tuning a map station, show it before the stream locks
  const shown = station ?? (!city && tuneStatus === 'tuning' ? request?.station : null) ?? null
  const freq = city ? city.freq : shown ? stationFreq(shown) : null
  // Always the real place the music comes from; a city preset is only context while scanning
  const place = shown
    ? `From ${shown.approx ? '~' : ''}${shown.location}`
    : city
      ? `${city.name} · ${city.countryCode}`
      : 'Tune any dot on the map'
  const clock = city
    ? localTimeAt(city.lon, city.lat, true, now, city.timeZone)
    : shown?.lat != null && shown.lon != null
      ? localTimeAt(shown.lon, shown.lat, true, now)
      : '--:--:--'

  const statusColor =
    tuneStatus === 'playing' ? 'text-lcd' : tuneStatus === 'error' ? 'text-hot' : tuneStatus === 'tuning' ? 'text-glow' : 'text-lcd-dim'
  // The radio and the background sounds are separate: say so when only the sounds are on
  const ambienceNote = powered && (tuneStatus === 'paused' || tuneStatus === 'error') ? ' · ambience still on' : ''
  const main = mainAction(powered, tuneStatus, retryTune)

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
        <button
          type="button"
          onClick={locateActive}
          disabled={!powered || (!city && shown?.lat == null)}
          title="Show on map (L)"
          className="mt-1 block w-full truncate text-left font-read text-[13px] leading-tight text-lcd/90 hover:underline disabled:no-underline"
        >
          {powered ? place : 'PIXEL RADIO'}
        </button>
        <div className="glow-text font-read text-[17px] leading-snug font-medium">
          <Marquee text={powered ? (station?.name ?? (tuneStatus === 'tuning' && shown ? shown.name : statusText)) : 'PRESS POWER'} />
        </div>
        {powered && song && station && (
          <div className="flex items-center gap-1 font-read text-[14px] leading-snug text-lcd/85" title="Now playing">
            <div className="min-w-0 flex-1">
              <Marquee text={`♪ ${song}`} />
            </div>
            <SaveSongButton title={song} station={station} />
          </div>
        )}
        {powered && <AtmosphereChip />}
        {powered && <JourneyBar />}
        {powered && <FallbackNotice />}
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[15px] leading-none">
          <span role="status" aria-live="polite" aria-atomic="true" className={`${statusColor} ${tuneStatus === 'tuning' ? 'blink' : ''} relative truncate`}>
            <span aria-hidden="true">{GLYPH[powered ? tuneStatus : 'idle']} </span>
            <span className="sr-only">{powered ? STATE_LABEL[tuneStatus] : 'Radio off'}: </span>
            {powered ? statusText : 'OFF'}
            {ambienceNote}
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
        <button
          type="button"
          onClick={main.run}
          disabled={!powered || main.disabled}
          aria-label={main.label}
          title={main.label}
          className="grid min-h-10 flex-[1.4] place-items-center rounded-[3px] border border-black bg-gradient-to-b from-amber-300 to-amber-500 px-2 text-black shadow-[0_2px_0_#000] transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white active:translate-y-0.5 active:shadow-none disabled:opacity-40"
        >
          <main.icon size={17} fill={main.icon === RotateCcw ? 'none' : 'currentColor'} />
        </button>
        <button
          type="button"
          onClick={() => station && toggleFavorite(station)}
          disabled={!powered || !station}
          aria-pressed={favorite}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          title={`${favorite ? 'Remove from' : 'Add to'} favorites (S)`}
          className={`grid flex-1 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2 shadow-[0_2px_0_#000] transition hover:text-amber-300 active:translate-y-0.5 active:shadow-none disabled:opacity-40 ${
            favorite ? 'text-amber-300' : 'text-zinc-200'
          }`}
        >
          <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          onClick={() => setDrawer('discover')}
          disabled={!powered || !station}
          aria-label="More like this station"
          title="More like this (E)"
          className="grid flex-1 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2 text-zinc-200 shadow-[0_2px_0_#000] transition hover:text-amber-300 active:translate-y-0.5 active:shadow-none disabled:opacity-40"
        >
          <Compass size={15} />
        </button>
        <ShareMenu className="grid flex-1 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2 text-zinc-200 shadow-[0_2px_0_#000] transition hover:text-amber-300 active:translate-y-0.5 active:shadow-none disabled:opacity-40" />
        {[
          { label: 'Previous station', key: 'B', icon: SkipBack, delta: -1 },
          { label: 'Next station', key: 'N', icon: SkipForward, delta: 1 },
        ].map(({ label, key, icon: Icon, delta }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={`${label} (${key})`}
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
