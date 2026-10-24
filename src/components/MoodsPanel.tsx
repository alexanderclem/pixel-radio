import { Check, Map as MapIcon, Pencil, Play, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ATMOSPHERES, musicFrom } from '../session/atmospheres'
import { sceneLine } from '../session/describe'
import { JOURNEYS, playJourney } from '../session/journeys'
import { customToAtmosphere, draftFrom, draftFromCurrent, type MoodDraft } from '../session/moods'
import { leaveAtmosphere, playAtmosphere } from '../session/play'
import { useRadioStore } from '../store/useRadioStore'
import { button, DrawerRow, RowButton } from './DrawerRow'
import { MoodEditor } from './MoodEditor'
import { MoodSchedules } from './MoodSchedules'

const heading = 'engraved font-term text-[13px] uppercase'

const HOW: [string, string][] = [
  ['Music', "Each mood finds a station to match: a genre, a city, or whatever's already playing. The display always shows where the station really is."],
  ['Scene', 'Weather and sky are themed for the mood, not the real weather at the station, and the display says “themed”.'],
  ['Sounds', 'Rain, wind, city, fire and a soft synth pad play under the music. Geo Link (sounds that follow the map) pauses while a mood is on.'],
  ['Timer', 'Some moods start a focus timer. Stop or change it any time.'],
  ['Yours', 'Make a mood from what’s on now, or customize a copy of any mood. Changes play as you edit. To keep one particular station with its mood, use Save this setup in the Saved tab instead.'],
  ['Leaving', 'The ✕ next to the mood on the display goes back to live weather and map-linked sounds. The music keeps playing, and your volume is never changed.'],
]

/** Moods to step into (built in and your own), and journeys to follow around the map. */
export function MoodsPanel() {
  const active = useRadioStore((s) => s.atmosphere?.id)
  const journey = useRadioStore((s) => s.journey?.id)
  const mine = useRadioStore((s) => s.library.moods)
  const removeMood = useRadioStore((s) => s.removeMood)
  const showToast = useRadioStore((s) => s.showToast)
  const [editing, setEditing] = useState<MoodDraft | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // Opening or closing the editor starts at the top, where the form and your moods are
  useEffect(() => {
    root.current?.closest('[role="tabpanel"]')?.scrollTo({ top: 0 })
  }, [editing])

  if (editing)
    return (
      <div ref={root}>
        <MoodEditor initial={editing} onDone={() => setEditing(null)} />
      </div>
    )

  const remove = (id: string, name: string) => {
    if (active === id) leaveAtmosphere()
    removeMood(id)
    setConfirming(null)
    showToast(`Deleted “${name}”`)
  }

  return (
    <div ref={root} className="flex flex-col gap-4">
      <section aria-label="About moods" className="flex flex-col gap-1.5">
        <p className="font-read text-[12px] leading-snug text-zinc-400">
          A mood sets the scene around the music: weather, sky, background sounds and sometimes a focus timer. It also finds a station to match.
        </p>
        <details className="group rounded-[3px] border border-black/60 bg-black/25 px-2 py-1.5">
          <summary className="cursor-pointer font-term text-[15px] leading-none tracking-wide text-zinc-200 uppercase hover:text-amber-300">
            How moods work
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 font-read text-[12px] leading-snug">
            {HOW.map(([term, text]) => (
              <div key={term} className="contents">
                <dt className="font-term text-[14px] leading-tight text-lcd uppercase">{term}</dt>
                <dd className="text-zinc-400">{text}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <section aria-labelledby="my-moods-heading" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 id="my-moods-heading" className={heading}>Your moods</h3>
          <button type="button" className={button} onClick={() => setEditing(draftFromCurrent())} title="Start from the weather, sky and sounds that are on now">
            <Plus size={14} /> New mood
          </button>
        </div>
        {mine.length === 0 ? (
          <p className="p-1 font-read text-[12px] leading-snug text-zinc-500">
            Moods you make show up here. Start a new one from what’s on now, or press <SlidersHorizontal size={11} className="inline align-[-1px]" /> on any mood below to customize a copy.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {mine.map((m) => {
              const atm = customToAtmosphere(m)
              return (
                <DrawerRow
                  key={m.id}
                  title={m.name}
                  active={active === m.id}
                  subtitle={<span title={`${sceneLine(m.settings)} · Music: ${musicFrom(atm)}`}>{sceneLine(m.settings)} · {musicFrom(atm)}</span>}
                  actions={
                    confirming === m.id ? (
                      <>
                        <RowButton label={`Delete ${m.name} for good`} onClick={() => remove(m.id, m.name)}>
                          <Check size={14} />
                        </RowButton>
                        <RowButton label={`Keep ${m.name}`} onClick={() => setConfirming(null)}>
                          <X size={14} />
                        </RowButton>
                      </>
                    ) : (
                      <>
                        <RowButton label={`Play ${m.name}`} onClick={() => void playAtmosphere(atm)}>
                          <Play size={14} fill="currentColor" />
                        </RowButton>
                        <RowButton label={`Edit ${m.name}`} onClick={() => setEditing(draftFrom(atm))}>
                          <Pencil size={13} />
                        </RowButton>
                        <RowButton label={`Delete ${m.name}`} onClick={() => setConfirming(m.id)}>
                          <Trash2 size={14} />
                        </RowButton>
                      </>
                    )
                  }
                />
              )
            })}
          </ul>
        )}
      </section>

      <MoodSchedules />

      <section aria-labelledby="moods-heading" className="flex flex-col gap-1.5">
        <h3 id="moods-heading" className={heading}>Atmospheres</h3>
        <ul className="flex flex-col gap-1.5">
          {ATMOSPHERES.map((atm) => (
            <li key={atm.id} className="flex items-start gap-1">
              <button
                type="button"
                onClick={() => void playAtmosphere(atm)}
                aria-pressed={active === atm.id}
                className="flex min-w-0 flex-1 items-start gap-2 rounded-[3px] border border-black bg-zinc-800/80 px-2 py-1.5 text-left hover:bg-zinc-700/80 aria-pressed:border-lcd/60"
              >
                <Play size={14} className="mt-1 shrink-0 text-zinc-300" fill="currentColor" />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="font-term text-[18px] leading-none text-lcd">{atm.name}</span>
                    {active === atm.id && <span className="font-read text-[10px] tracking-wide text-lcd-dim uppercase">On now</span>}
                  </span>
                  <span className="block font-read text-[12px] leading-snug text-zinc-300">{atm.tagline}</span>
                  <span className="block font-read text-[11px] leading-snug text-zinc-400">{sceneLine(atm.settings)}</span>
                  <span className="block font-read text-[11px] leading-snug text-zinc-500">Music: {musicFrom(atm)}</span>
                </span>
              </button>
              <RowButton label={`Customize ${atm.name}: make your own copy`} onClick={() => setEditing(draftFrom(atm))}>
                <SlidersHorizontal size={13} />
              </RowButton>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="journeys-heading" className="flex flex-col gap-1.5">
        <h3 id="journeys-heading" className={heading}>Journeys</h3>
        <ul className="flex flex-col gap-1.5">
          {JOURNEYS.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                onClick={() => void playJourney(j)}
                aria-pressed={journey === j.id}
                className="flex w-full items-start gap-2 rounded-[3px] border border-black bg-zinc-800/80 px-2 py-1.5 text-left hover:bg-zinc-700/80 aria-pressed:border-lcd/60"
              >
                <MapIcon size={14} className="mt-1 shrink-0 text-zinc-300" />
                <span className="min-w-0">
                  <span className="block font-term text-[18px] leading-none text-lcd">{j.name}</span>
                  <span className="block font-read text-[12px] leading-snug text-zinc-300">{j.description}</span>
                  <span className="block font-read text-[11px] leading-snug text-zinc-500">{j.stops.map((s) => s.city).join(' → ')}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
