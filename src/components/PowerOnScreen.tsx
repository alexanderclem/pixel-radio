import { AlarmClock, History, Power, Radio } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { CITIES } from '../constants/cities'
import { ATMOSPHERES, musicFrom } from '../session/atmospheres'
import { JOURNEYS, playJourney } from '../session/journeys'
import { customToAtmosphere, findMood } from '../session/moods'
import { ago, moodLine } from '../session/describe'
import { playAtmosphere, playSaved, playShared, playSetup } from '../session/play'
import { resolveStationId } from '../social/friendStation'
import { useRadioStore } from '../store/useRadioStore'
import { liveWeather } from '../weather/liveWeather'
import { SiteLinks } from './SiteLinks'

const VERB: Record<string, string> = { rain: 'raining', storm: 'storming', snow: 'snowing' }

/** "Right now it's raining in Tokyo and snowing in Reykjavik", from the real weather, as it arrives. */
function liveWorldLine(): string | null {
  const wet = CITIES.flatMap((c) => {
    const w = liveWeather.get(c.lat, c.lon)
    return w && VERB[w.type] ? [`${VERB[w.type]} in ${c.name}`] : []
  }).slice(0, 2)
  return wet.length ? `Right now it's ${wet.join(' and ')}.` : null
}

function useLiveLine() {
  const [line, setLine] = useState<string | null>(null)
  useEffect(() => {
    // Weather arrives one city at a time; ask again until the line settles
    const id = window.setInterval(() => setLine(liveWorldLine()), 1500)
    return () => window.clearInterval(id)
  }, [])
  return line
}

const card =
  'group flex w-full flex-col items-start gap-1 rounded-md border-2 border-black bg-gradient-to-b from-zinc-700/90 to-zinc-900/90 px-3 py-2.5 text-left shadow-[0_3px_0_#000] transition hover:border-amber-400/70 active:translate-y-0.5 active:shadow-none disabled:opacity-50'
const primary =
  'flex items-center justify-center gap-3 rounded-md border-2 border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-6 py-3 font-pixel text-[12px] text-zinc-100 shadow-[0_4px_0_#000] transition hover:text-amber-300 active:translate-y-1 active:shadow-none disabled:opacity-60'
/** The first moods get cards; the rest, and the listener's own, fit on one line below */
const FEATURED = 3

const quiet = 'font-read text-[14px] text-lcd-dim underline decoration-dotted underline-offset-4 hover:text-lcd disabled:opacity-50'

/**
 * The first screen, and the gesture audio needs. It leads with how to listen: resume,
 * a mood, or just the radio. Shared links take it over with what was shared.
 */
export function PowerOnScreen({ onPower }: { onPower: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const launch = useRadioStore((s) => s.launch)
  const pending = useRadioStore((s) => s.pendingSession)
  const last = useRadioStore((s) => s.lastSession)
  const myMoods = useRadioStore((s) => s.library.moods)
  const setPendingSession = useRadioStore((s) => s.setPendingSession)
  const ready = useRadioStore((s) => s.scheduleReady)
  const setScheduleReady = useRadioStore((s) => s.setScheduleReady)
  const online = useRadioStore((s) => s.world.online)
  const worldOn = useRadioStore((s) => s.world.synced)
  const publicMode = useRadioStore((s) => s.social.publicMode)
  const liveLine = useLiveLine()

  const start = (action: () => Promise<unknown>) => async () => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  let body: ReactNode
  if (pending) {
    const { station, settings, stationId } = pending
    body = (
      <section aria-label="Shared session" className="flex w-full flex-col items-center gap-3">
        <p className="engraved font-term text-[15px] uppercase">Someone shared a session</p>
        <div className="w-full rounded-md border border-black bg-black/40 px-3 py-2 text-center">
          <p className="glow-text font-read text-[17px] font-medium text-lcd">{station ? station.name : 'Looking up the station…'}</p>
          {station && <p className="font-read text-[13px] text-lcd-dim">Playing from {station.location}</p>}
          {moodLine(settings) && <p className="mt-1 font-read text-[13px] text-lcd/80">{moodLine(settings)}</p>}
        </div>
        <button
          type="button"
          className={primary}
          disabled={busy}
          onClick={start(async () => {
            setPendingSession(null)
            await playShared(stationId, station, settings)
          })}
        >
          <Power size={18} strokeWidth={3} className="text-hot drop-shadow-[0_0_6px_#ff4d6d]" />
          {busy ? 'WARMING UP…' : 'START LISTENING'}
        </button>
        <button
          type="button"
          className={quiet}
          disabled={busy}
          onClick={start(async () => {
            setPendingSession(null)
            await playSetup(station ?? resolveStationId(stationId), {})
          })}
        >
          Just the station, keep my own sound and weather
        </button>
      </section>
    )
  } else if (launch) {
    body = (
      <section aria-label="Shared station" className="flex flex-col items-center gap-3">
        <button type="button" onClick={start(onPower)} disabled={busy} className={primary}>
          <Power size={18} strokeWidth={3} className="text-hot drop-shadow-[0_0_6px_#ff4d6d]" />
          {busy ? 'WARMING UP…' : 'TUNE IN'}
        </button>
        <p className="text-center font-read text-[16px] leading-tight text-lcd">
          {launch.name}
          <span className="block text-[13px] text-lcd-dim">{launch.location}</span>
        </p>
      </section>
    )
  } else {
    const readyMood = ready ? findMood(ready.moodId) : null
    body = (
      <div className="flex w-full flex-col gap-3">
        {ready && readyMood && (
          <div className="flex w-full items-stretch gap-2">
            <button
              type="button"
              className={`${card} border-amber-400/70`}
              disabled={busy}
              onClick={start(() => {
                setScheduleReady(null)
                return playAtmosphere(readyMood)
              })}
            >
              <span className="flex items-center gap-2 font-term text-[20px] leading-none text-amber-300">
                <AlarmClock size={16} /> {ready.name} is ready
              </span>
              <span className="font-read text-[13px] text-zinc-300">Your scheduled mood. Click to start listening.</span>
            </button>
            <button type="button" className={quiet} onClick={() => setScheduleReady(null)}>
              Not now
            </button>
          </div>
        )}
        {last && (
          <button type="button" className={card} disabled={busy} onClick={start(() => playSaved(last))}>
            <span className="flex items-center gap-2 font-term text-[20px] leading-none text-amber-300">
              <History size={16} /> Resume
            </span>
            <span className="font-read text-[14px] font-medium text-lcd">{last.station.name}</span>
            <span className="font-read text-[12px] text-zinc-400">
              {[last.station.location, moodLine(last), ago(last.savedAt)].filter(Boolean).join(' · ')}
            </span>
          </button>
        )}
        <p className="engraved -mb-1 font-term text-[14px] uppercase">Pick a mood</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {ATMOSPHERES.slice(0, FEATURED).map((atm) => (
            <button key={atm.id} type="button" className={card} disabled={busy} onClick={start(() => playAtmosphere(atm))}>
              <span className="font-term text-[20px] leading-none text-lcd glow-text">{atm.name}</span>
              <span className="font-read text-[12px] leading-snug text-zinc-300">{atm.tagline}</span>
              <span className="font-read text-[11px] leading-snug text-zinc-500">Music: {musicFrom(atm)}</span>
            </button>
          ))}
        </div>
        <p className="font-read text-[13px] text-zinc-400">
          More moods:{' '}
          {[...myMoods.map(customToAtmosphere), ...ATMOSPHERES.slice(FEATURED)].map((atm, i) => (
            <span key={atm.id}>
              {i > 0 && ' · '}
              <button type="button" className={quiet} disabled={busy} onClick={start(() => playAtmosphere(atm))} title={atm.tagline || undefined}>
                {atm.name}
              </button>
            </span>
          ))}
        </p>
        <button type="button" className={`${card} flex-row items-center`} disabled={busy} onClick={start(onPower)}>
          <Radio size={16} className="text-zinc-300" />
          <span className="font-term text-[19px] leading-none text-zinc-200">Just the radio</span>
          <span className="hidden font-read text-[12px] text-zinc-500 sm:inline">· tune the map yourself</span>
        </button>
        <p className="font-read text-[13px] text-zinc-400">
          Or take a journey:{' '}
          {JOURNEYS.map((j, i) => (
            <span key={j.id}>
              {i > 0 && ' · '}
              <button type="button" className={quiet} disabled={busy} onClick={start(() => playJourney(j))}>
                {j.name}
              </button>
            </span>
          ))}
        </p>
      </div>
    )
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { delay: 0.35, duration: 0.25 } }}
    >
      <div className="grid min-h-full place-items-center">
        <motion.div
          className="brushed w-full max-w-xl rounded-lg p-1.5"
          exit={{ scaleY: [1, 0.012, 0.012], scaleX: [1, 1, 0], transition: { duration: 0.5, times: [0, 0.6, 1] } }}
        >
          <div className="lcd flex flex-col items-center gap-4 rounded-md px-4 py-6 text-center sm:px-6">
            <h1 className="font-pixel text-[22px] leading-tight text-glow glow-text">
              PIXEL
              <br />
              RADIO
            </h1>
            <p className="max-w-sm font-read text-[15px] leading-snug text-lcd">Settle into a real radio station somewhere in the world.</p>
            {(liveLine || online > 1) && (
              <p className="-mt-2 max-w-sm font-read text-[12px] leading-snug text-lcd-dim">
                {[liveLine, online > 1 ? `${online.toLocaleString()} people listening now.` : null].filter(Boolean).join(' ')}
              </p>
            )}
            {body}
            <p className="font-read text-[12px] leading-tight text-lcd-dim">Headphones recommended · press ? for shortcuts</p>
            {worldOn && publicMode !== 'hidden' && (
              <p className="-mt-2 max-w-sm font-read text-[11px] leading-snug text-lcd-dim/80">
                Others on the map see you as an anonymous listener at your station. You can hide in Friends.
              </p>
            )}
            {busy && !error && <p className="font-read text-[13px] text-lcd blink">Finding a station…</p>}
            {error && (
              <p role="alert" className="font-read text-[14px] text-hot">
                Audio failed to start: {error}
              </p>
            )}
            <SiteLinks />
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}
