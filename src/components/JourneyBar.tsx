import { SkipForward, X } from 'lucide-react'
import { JOURNEY_BY_ID, playJourney } from '../session/journeys'
import { useRadioStore } from '../store/useRadioStore'

/** "Journey · Jazz Around the World · 2/6", the stop's note, and the way to the next stop. */
export function JourneyBar() {
  const journey = useRadioStore((s) => s.journey)
  const setJourney = useRadioStore((s) => s.setJourney)
  const def = journey ? JOURNEY_BY_ID[journey.id] : null
  if (!journey || !def) return null
  const stop = def.stops[journey.index]
  const last = journey.index >= def.stops.length - 1
  return (
    <div className="mt-1 flex min-w-0 items-start gap-1.5 font-read text-[12px] leading-snug">
      <div className="min-w-0 flex-1">
        <p className="truncate text-lcd">
          Journey · {def.name} · {journey.index + 1}/{def.stops.length}
        </p>
        <p className="truncate text-lcd-dim">{stop.note}</p>
      </div>
      {!last && (
        <button
          type="button"
          onClick={() => void playJourney(def, journey.index + 1)}
          title={`Next stop: ${def.stops[journey.index + 1].name}, ${def.stops[journey.index + 1].city}`}
          className="flex shrink-0 items-center gap-1 rounded-[2px] border border-lcd/40 px-1.5 py-0.5 text-lcd hover:bg-lcd/10"
        >
          Next stop <SkipForward size={11} />
        </button>
      )}
      <button
        type="button"
        onClick={() => setJourney(null)}
        aria-label={`End the ${def.name} journey`}
        title="End the journey (the music keeps playing)"
        className="grid size-5 shrink-0 place-items-center text-lcd-dim hover:text-lcd"
      >
        <X size={12} />
      </button>
    </div>
  )
}
