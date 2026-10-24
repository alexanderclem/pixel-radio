import { AlarmClock, History, Map as MapIcon, Power } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { ATMOSPHERES } from '../session/atmospheres'
import { JOURNEYS, playJourney } from '../session/journeys'
import { customToAtmosphere, findMood } from '../session/moods'
import { ago, moodLine } from '../session/describe'
import { playAtmosphere, playSaved, playShared, playSetup } from '../session/play'
import { resolveStationId } from '../social/friendStation'
import { useRadioStore } from '../store/useRadioStore'
import { SiteLinks } from './SiteLinks'

const card =
  'group flex w-full flex-col items-start gap-1 rounded-md border-2 border-black bg-gradient-to-b from-zinc-700/90 to-zinc-900/90 px-3 py-2.5 text-left shadow-[0_3px_0_#000] transition hover:border-amber-400/70 active:translate-y-0.5 active:shadow-none disabled:opacity-50'
const primary =
  'flex items-center justify-center gap-3 rounded-md border-2 border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-6 py-3 font-pixel text-[12px] text-zinc-100 shadow-[0_4px_0_#000] transition hover:text-amber-300 active:translate-y-1 active:shadow-none disabled:opacity-60'
/** The three first choices, in words about the experience rather than how a station is picked */
const FEATURED: Record<string, string> = {
  'rainy-tokyo': 'A Tokyo-area station and rain over the city.',
  'morning-jazz': 'Jazz, warm light, and a crackling fire.',
  'quiet-study': 'Calm radio and soft rain for your next focus session.',
}
const secondary =
  'flex w-full items-center justify-center gap-2 rounded-md border-2 border-zinc-600 bg-black/30 px-3 py-2 font-term text-[19px] leading-none text-zinc-100 transition hover:border-amber-400/70 hover:text-amber-300 disabled:opacity-50'
const disclosure = 'group rounded-[3px] border border-black/60 bg-black/30 px-2.5 py-2'
const summary =
  'cursor-pointer font-term text-[17px] leading-none tracking-wide text-zinc-100 uppercase hover:text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none'
const listItem =
  'flex w-full flex-col items-start gap-0.5 rounded-[3px] px-2 py-1.5 text-left hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none disabled:opacity-50'

const quiet = 'font-read text-[14px] text-lcd-dim underline decoration-dotted underline-offset-4 hover:text-lcd disabled:opacity-50'

/**
 * The first screen, and the gesture audio needs. It leads with how to listen: resume,
 * a mood, or just the radio. Shared links take it over with what was shared.
 */
export function PowerOnScreen({ onPower }: { onPower: () => Promise<void> }) {
  /** Which choice is starting, so only it says "Tuning…" */
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const launch = useRadioStore((s) => s.launch)
  const pending = useRadioStore((s) => s.pendingSession)
  const last = useRadioStore((s) => s.lastSession)
  const myMoods = useRadioStore((s) => s.library.moods)
  const setPendingSession = useRadioStore((s) => s.setPendingSession)
  const ready = useRadioStore((s) => s.scheduleReady)
  const setScheduleReady = useRadioStore((s) => s.setScheduleReady)
  const worldOn = useRadioStore((s) => s.world.synced)
  const publicMode = useRadioStore((s) => s.social.publicMode)
  const setSocial = useRadioStore((s) => s.setSocial)

  const start = (id: string, action: () => Promise<unknown>) => async () => {
    setBusy(id)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Normally this screen has closed by now; if the radio didn't come on, every choice is open again
      setBusy(null)
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
          disabled={busy !== null}
          onClick={start('shared', async () => {
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
          disabled={busy !== null}
          onClick={start('station', async () => {
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
        <button type="button" onClick={start('launch', onPower)} disabled={busy !== null} className={primary}>
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
    const more = [...myMoods.map(customToAtmosphere), ...ATMOSPHERES.filter((a) => !FEATURED[a.id])]
    body = (
      <div className="flex w-full flex-col gap-3">
        {ready && readyMood && (
          <div className="flex w-full items-stretch gap-2">
            <button
              type="button"
              className={`${card} border-amber-400/70`}
              disabled={busy !== null}
              onClick={start('ready', () => {
                setScheduleReady(null)
                return playAtmosphere(readyMood)
              })}
            >
              <span className="flex items-center gap-2 font-term text-[20px] leading-none text-amber-300">
                <AlarmClock size={16} /> {busy === 'ready' ? 'Tuning…' : `${ready.name} is ready`}
              </span>
              <span className="font-read text-[14px] text-zinc-200">Your scheduled mood. Click to start listening.</span>
            </button>
            <button type="button" className={quiet} onClick={() => setScheduleReady(null)}>
              Not now
            </button>
          </div>
        )}
        {last && (
          <button type="button" className={card} disabled={busy !== null} onClick={start('resume', () => playSaved(last))}>
            <span className="flex items-center gap-2 font-term text-[20px] leading-none text-amber-300">
              <History size={16} /> {busy === 'resume' ? 'Tuning…' : 'Resume'}
            </span>
            <span className="font-read text-[15px] font-medium text-lcd">{last.station.name}</span>
            <span className="font-read text-[13px] text-zinc-300">
              {[last.station.location, moodLine(last), ago(last.savedAt)].filter(Boolean).join(' · ')}
            </span>
          </button>
        )}
        <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Moods">
          {ATMOSPHERES.filter((a) => FEATURED[a.id]).map((atm) => (
            <button key={atm.id} type="button" className={card} disabled={busy !== null} onClick={start(atm.id, () => playAtmosphere(atm))}>
              <span className="font-term text-[21px] leading-none text-lcd glow-soft">{busy === atm.id ? 'Tuning…' : atm.name}</span>
              <span className="font-read text-[14px] leading-snug text-zinc-200">{FEATURED[atm.id]}</span>
            </button>
          ))}
        </div>
        <button type="button" className={secondary} disabled={busy !== null} onClick={start('map', onPower)}>
          <MapIcon size={16} />
          {busy === 'map' ? 'Tuning…' : 'Explore the radio map'}
        </button>
        <div className="flex flex-col gap-1.5 text-left">
          <details className={disclosure}>
            <summary className={summary}>More atmospheres</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {more.map((atm) => (
                <li key={atm.id}>
                  <button type="button" className={listItem} disabled={busy !== null} onClick={start(atm.id, () => playAtmosphere(atm))}>
                    <span className="font-term text-[18px] leading-none text-lcd">{busy === atm.id ? 'Tuning…' : atm.name}</span>
                    {atm.tagline && <span className="font-read text-[13px] leading-snug text-zinc-300">{atm.tagline}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <details className={disclosure}>
            <summary className={summary}>Radio journeys</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {JOURNEYS.map((j) => (
                <li key={j.id}>
                  <button type="button" className={listItem} disabled={busy !== null} onClick={start(j.id, () => playJourney(j))}>
                    <span className="font-term text-[18px] leading-none text-lcd">{busy === j.id ? 'Tuning…' : j.name}</span>
                    <span className="font-read text-[13px] leading-snug text-zinc-300">{j.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
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
            {!pending && !launch && (
              <div className="-mt-1 flex max-w-md flex-col gap-1">
                <p className="font-read text-[18px] leading-snug font-medium text-lcd">Pick somewhere to settle in.</p>
                <p className="font-read text-[15px] leading-snug text-zinc-200">Live radio from around the world, with atmosphere for studying, working, or unwinding.</p>
              </div>
            )}
            {body}
            {error && (
              <p role="alert" className="font-read text-[15px] text-hot">
                Audio didn't start: {error}. Pick again to retry.
              </p>
            )}
            {worldOn && (
              <p className="max-w-md font-read text-[13px] leading-snug text-zinc-300">
                {publicMode === 'hidden'
                  ? "You're hidden from other listeners on the map. "
                  : `Other listeners on the map see you as ${publicMode === 'named' ? 'your nickname' : 'an anonymous listener'} at your station. `}
                <button
                  type="button"
                  className="text-lcd underline decoration-dotted underline-offset-4 hover:text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
                  onClick={() => setSocial({ publicMode: publicMode === 'hidden' ? 'anonymous' : 'hidden' })}
                >
                  {publicMode === 'hidden' ? 'Show me as anonymous' : 'Hide me'}
                </button>
              </p>
            )}
            <SiteLinks />
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}
