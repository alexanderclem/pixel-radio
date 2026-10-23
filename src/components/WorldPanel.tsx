import { Play } from 'lucide-react'
import { resolveStationId } from '../social/friendStation'
import type { PublicMode } from '../social/protocol'
import { useRadioStore } from '../store/useRadioStore'
import { DrawerRow, RowButton } from './DrawerRow'

const MODES: { value: PublicMode; label: string; help: string }[] = [
  { value: 'anonymous', label: 'Anonymous', help: 'Strangers see your avatar at your station, labelled "listener". Never your name.' },
  { value: 'named', label: 'Named', help: 'Strangers see your avatar and nickname at your station.' },
  { value: 'hidden', label: 'Hidden', help: 'Strangers see nothing. Friends still see you unless you appear offline.' },
]

/** How strangers see you in the public world. */
export function WorldPrivacy({ guest = false }: { guest?: boolean }) {
  const mode = useRadioStore((s) => s.social.publicMode)
  const setSocial = useRadioStore((s) => s.setSocial)
  // Only when the friends server has a public world (an older one doesn't)
  const available = useRadioStore((s) => s.world.synced || s.friends.serverVersion >= 2)
  if (!available) return null
  const options = guest ? MODES.filter((m) => m.value !== 'named') : MODES
  const current = MODES.find((m) => m.value === (guest && mode === 'named' ? 'anonymous' : mode)) ?? MODES[0]
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="engraved mb-1 font-term text-[13px] uppercase">In the public world</legend>
      <div role="radiogroup" aria-label="How strangers see you" className="flex overflow-hidden rounded-[3px] border border-black">
        {options.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={current.value === m.value}
            onClick={() => setSocial({ publicMode: m.value })}
            className={`flex-1 px-2 py-1 font-term text-[15px] leading-none uppercase ${
              current.value === m.value ? 'bg-amber-400/90 text-black' : 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-300 hover:text-amber-200'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="font-read text-[12px] leading-snug text-zinc-500">{current.help}</p>
    </fieldset>
  )
}

/** The busiest stations right now, with how many friends are there. */
export function AroundTheWorld() {
  const crowds = useRadioStore((s) => s.world.crowds)
  const online = useRadioStore((s) => s.world.online)
  const synced = useRadioStore((s) => s.world.synced)
  const friends = useRadioStore((s) => s.friends.list)
  const powered = useRadioStore((s) => s.powered)
  const playingId = useRadioStore((s) => s.station?.id)
  if (!synced) return null
  const friendsAt = (id: string) => friends.filter((f) => f.online && f.presence?.station?.id === id).length
  return (
    <section aria-labelledby="world-heading">
      <h3 id="world-heading" className="engraved mb-1 font-term text-[13px] uppercase">
        Around the world · {online.toLocaleString()} online
      </h3>
      {crowds.length === 0 ? (
        <p className="p-1 font-read text-[13px] leading-snug text-zinc-500">Nobody is sharing a station right now.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {crowds.slice(0, 10).map((c) => {
            const pals = friendsAt(c.stationId)
            return (
              <DrawerRow
                key={c.stationId}
                title={c.name}
                active={c.stationId === playingId}
                subtitle={[`${c.count} listening`, pals ? `${pals} friend${pals > 1 ? 's' : ''}` : null, c.location].filter(Boolean).join(' · ')}
                actions={
                  <RowButton
                    label={`Tune in to ${c.name}`}
                    disabled={!powered}
                    onClick={() =>
                      void resolveStationId(c.stationId).then((st) =>
                        st ? useRadioStore.getState().requestStation(st, true) : useRadioStore.getState().showToast(`Couldn't find ${c.name} in the directory`),
                      )
                    }
                  >
                    <Play size={14} fill="currentColor" />
                  </RowButton>
                }
              />
            )
          })}
        </ul>
      )}
    </section>
  )
}
