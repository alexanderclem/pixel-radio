import { X } from 'lucide-react'
import { leaveAtmosphere } from '../session/play'
import { useRadioStore } from '../store/useRadioStore'

/**
 * Says the mood is themed: which atmosphere, and that its weather isn't the station's real
 * weather. The station's own location stays on the line above.
 */
export function AtmosphereChip() {
  const atmosphere = useRadioStore((s) => s.atmosphere)
  const mode = useRadioStore((s) => s.weather.mode)
  if (!atmosphere) return null
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5 font-read text-[12px] leading-tight">
      <span
        className="min-w-0 truncate rounded-[2px] border border-lcd/40 px-1.5 py-0.5 text-lcd"
        title={mode === 'auto' ? 'Live weather where you are looking' : `The ${mode} is part of the atmosphere, not the weather at the station`}
      >
        Atmosphere · {atmosphere.name}
        <span className="text-lcd-dim">{mode === 'auto' ? ' · live weather' : ` · themed ${mode}`}</span>
        {mode !== 'auto' && <span className="sr-only">, not the real weather at the station</span>}
      </span>
      <button
        type="button"
        onClick={leaveAtmosphere}
        aria-label={`Leave ${atmosphere.name}: back to live weather and map-linked sound`}
        title="Leave the atmosphere (the music keeps playing)"
        className="grid size-5 shrink-0 place-items-center rounded-[2px] text-lcd-dim hover:text-lcd"
      >
        <X size={12} />
      </button>
    </div>
  )
}
