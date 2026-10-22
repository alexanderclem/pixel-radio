import { MapPin, RotateCcw } from 'lucide-react'
import { playAnotherNearby, retryWanted } from '../session/recovery'
import { useRadioStore } from '../store/useRadioStore'

const button =
  'flex items-center gap-1 rounded-[2px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2 py-0.5 font-read text-[12px] leading-tight text-zinc-100 shadow-[0_1px_0_#000] hover:text-amber-300'

/**
 * When the radio plays something other than what was asked for, or nothing: what happened,
 * what is playing instead and where it really is, and two ways forward.
 */
export function FallbackNotice() {
  const fallback = useRadioStore((s) => s.fallback)
  const station = useRadioStore((s) => (s.tuneStatus === 'playing' ? s.station : null))
  const tuneStatus = useRadioStore((s) => s.tuneStatus)
  if (!fallback || tuneStatus === 'tuning') return null

  const what =
    fallback.reason === 'directory'
      ? "The station directory didn't answer"
      : fallback.reason === 'dropped'
        ? `${fallback.wanted} dropped out`
        : fallback.reason === 'failed'
          ? `Nothing answered for ${fallback.wanted}`
          : `${fallback.wanted} isn't answering`
  const instead = station ? `, so this is ${station.name}, from ${station.location}, instead.` : '. The station may be off the air or blocking web players.'

  return (
    <div role="status" className="mt-1.5 rounded-[3px] border border-amber-400/40 bg-amber-400/10 px-2 py-1.5 font-read text-[12px] leading-snug text-amber-100">
      <p>
        {what}
        {instead}
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <button type="button" className={button} onClick={retryWanted}>
          <RotateCcw size={12} /> {fallback.wantedStation ? `Retry ${fallback.wantedStation.name}` : 'Try again'}
        </button>
        <button type="button" className={button} onClick={playAnotherNearby}>
          <MapPin size={12} /> Another nearby station
        </button>
      </div>
    </div>
  )
}
