import { Play } from 'lucide-react'
import { hm, totals, week } from '../progress/progress'
import { EARNABLE, isEarned, unlockLabel, unlockProgress } from '../progress/unlocks'
import { resolveStationId } from '../social/friendStation'
import { useRadioStore } from '../store/useRadioStore'
import { DrawerRow, RowButton } from './DrawerRow'

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' })
  } catch {
    return null
  }
})()

/** A stamp's ink, picked from its country code so it never changes. */
function ink(code: string) {
  const hues = [8, 32, 48, 145, 175, 200, 225, 265, 300, 335]
  const h = hues[(code.charCodeAt(0) * 31 + code.charCodeAt(1)) % hues.length]
  return `hsl(${h} 70% 62%)`
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-[3px] bg-black/30 px-1 py-1.5">
      <span className="glow-text font-term text-[24px] leading-none text-lcd tabular-nums">{value}</span>
      <span className="font-read text-[11px] leading-tight text-lcd-dim">{label}</span>
    </div>
  )
}

/** Where you've listened, how you've focused, and what your avatar can earn next. */
export function PassportPanel() {
  const progress = useRadioStore((s) => s.progress)
  const powered = useRadioStore((s) => s.powered)
  const flyTo = useRadioStore((s) => s.flyTo)
  const t = totals(progress)
  const w = week(progress)
  const countries = Object.entries(progress.countries).sort((a, b) => a[1].firstAt - b[1].firstAt)
  const stations = Object.entries(progress.stations).sort((a, b) => b[1].minutes - a[1].minutes)

  const topStationIn = (code: string) => stations.find(([, s]) => s.country === code && s.lat !== null && s.lon !== null)?.[1]

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Totals" className="lcd grid grid-cols-3 gap-1.5 rounded-[3px] p-2">
        <Stat value={String(t.countries)} label="countries" />
        <Stat value={String(t.stations)} label="stations" />
        <Stat value={hm(t.listenedHours * 60)} label="listened" />
        <Stat value={String(t.streak)} label="day streak" />
        <Stat value={hm(w.minutes)} label="focus this week" />
        <Stat value={hm(w.together)} label="with friends" />
      </section>

      <section aria-labelledby="stamps-heading" className="flex flex-col gap-1.5">
        <h3 id="stamps-heading" className="engraved font-term text-[13px] uppercase">Stamps</h3>
        {countries.length === 0 ? (
          <p className="font-read text-[12px] leading-snug text-zinc-500">Listen to a station for two minutes to stamp its country here.</p>
        ) : (
          <ul className="grid grid-cols-4 gap-1.5">
            {countries.map(([code, c]) => {
              const top = topStationIn(code)
              const name = regionNames?.of(code) ?? code
              return (
                <li key={code}>
                  <button
                    type="button"
                    disabled={!top}
                    onClick={() => top && flyTo(top.lon!, top.lat!, 5)}
                    title={`${name} · first heard ${new Date(c.firstAt).toLocaleDateString()} · ${hm(c.minutes)}`}
                    aria-label={`${name}, first heard ${new Date(c.firstAt).toLocaleDateString()}`}
                    className="flex aspect-square w-full -rotate-3 flex-col items-center justify-center rounded-[4px] border-2 border-dashed bg-black/20 transition hover:rotate-0"
                    style={{ borderColor: ink(code), color: ink(code) }}
                  >
                    <span className="font-pixel text-[13px] leading-none">{code}</span>
                    <span className="mt-1 max-w-full truncate px-0.5 font-read text-[9px] leading-none">{name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {stations.length > 0 && (
        <section aria-labelledby="most-heading" className="flex flex-col gap-1.5">
          <h3 id="most-heading" className="engraved font-term text-[13px] uppercase">Most listened</h3>
          <ul className="flex flex-col gap-1">
            {stations.slice(0, 8).map(([id, s]) => (
              <DrawerRow
                key={id}
                title={s.name}
                subtitle={`${hm(s.minutes)} · ${s.location}`}
                actions={
                  <RowButton
                    label={`Play ${s.name}`}
                    disabled={!powered}
                    onClick={() => void resolveStationId(id).then((st) => st && useRadioStore.getState().requestStation(st, true))}
                  >
                    <Play size={14} fill="currentColor" />
                  </RowButton>
                }
              />
            ))}
          </ul>
        </section>
      )}

      <EarnList />
    </div>
  )
}

/** Avatar parts still to earn, with how far along you are. */
export function EarnList() {
  const progress = useRadioStore((s) => s.progress)
  const t = totals(progress)
  const left = EARNABLE.filter((p) => !isEarned(p.unlock, t))
  if (!left.length) return <p className="font-read text-[12px] text-lcd">Every avatar part earned. Nice listening.</p>
  return (
    <section aria-labelledby="earn-heading" className="flex flex-col gap-1.5">
      <h3 id="earn-heading" className="engraved font-term text-[13px] uppercase">Earn for your avatar</h3>
      <ul className="flex flex-col gap-1">
        {left.map((p) => {
          const have = unlockProgress(p.unlock, t)
          return (
            <li key={p.key} className="font-read text-[12px] leading-snug text-zinc-300">
              <div className="flex justify-between gap-2">
                <span className="truncate">
                  <span className="text-zinc-100">{p.name}</span> · {unlockLabel(p.unlock).toLowerCase()}
                </span>
                <span className="shrink-0 text-zinc-500 tabular-nums">
                  {have}/{p.unlock.n}
                </span>
              </div>
              <div className="mt-0.5 h-1 overflow-hidden rounded bg-zinc-700" aria-hidden>
                <div className="h-full bg-lcd" style={{ width: `${(100 * have) / p.unlock.n}%` }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
