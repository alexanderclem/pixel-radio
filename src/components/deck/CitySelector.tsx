import { CITIES } from '../../constants/cities'
import { useRadioStore } from '../../store/useRadioStore'

/** Preset buttons mirroring the map hotspots. */
export function CitySelector() {
  const selectedCityId = useRadioStore((s) => s.selectedCityId)
  const selectCity = useRadioStore((s) => s.selectCity)
  const powered = useRadioStore((s) => s.powered)

  return (
    <div role="group" aria-label="City presets" className="grid grid-cols-6 gap-1">
      {CITIES.map((c) => {
        const active = c.id === selectedCityId
        return (
          <button
            key={c.id}
            type="button"
            title={`${c.name}, ${c.country} · ${c.freq.toFixed(1)} FM`}
            aria-pressed={active}
            disabled={!powered}
            onClick={() => selectCity(c.id)}
            className={`rounded-[2px] border border-black py-1 font-term text-[14px] leading-none tracking-wider shadow-[0_2px_0_#000] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40 ${
              active
                ? 'bg-gradient-to-b from-amber-300 to-amber-500 text-black shadow-[0_0_10px_rgb(255_180_70/0.6),0_2px_0_#000]'
                : 'bg-gradient-to-b from-zinc-600 to-zinc-800 text-zinc-200 hover:text-amber-200'
            }`}
          >
            {c.code}
          </button>
        )
      })}
    </div>
  )
}
