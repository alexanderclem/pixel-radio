import { Play } from 'lucide-react'
import { ATMOSPHERES } from '../session/atmospheres'
import { playAtmosphere } from '../session/play'
import { useRadioStore } from '../store/useRadioStore'

/** Atmospheres you can step into (journeys join them in the same tab). */
export function MoodsPanel() {
  const active = useRadioStore((s) => s.atmosphere?.id)
  return (
    <section aria-labelledby="moods-heading" className="flex flex-col gap-1.5">
      <h3 id="moods-heading" className="engraved font-term text-[13px] uppercase">Atmospheres</h3>
      <p className="font-read text-[12px] leading-snug text-zinc-500">
        Themed weather and sound around a real station. The display always shows where the music really comes from.
      </p>
      <ul className="flex flex-col gap-1.5">
        {ATMOSPHERES.map((atm) => (
          <li key={atm.id}>
            <button
              type="button"
              onClick={() => void playAtmosphere(atm)}
              aria-pressed={active === atm.id}
              className="flex w-full items-start gap-2 rounded-[3px] border border-black bg-zinc-800/80 px-2 py-1.5 text-left hover:bg-zinc-700/80 aria-pressed:border-lcd/60"
            >
              <Play size={14} className="mt-1 shrink-0 text-zinc-300" fill="currentColor" />
              <span className="min-w-0">
                <span className="block font-term text-[18px] leading-none text-lcd">{atm.name}</span>
                <span className="block font-read text-[12px] leading-snug text-zinc-300">{atm.tagline}</span>
                <span className="block font-read text-[11px] leading-snug text-zinc-500">Music: {atm.source.toLowerCase()}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
