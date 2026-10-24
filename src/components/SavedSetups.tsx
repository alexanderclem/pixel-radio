import { Check, Link, Pencil, Play, Save, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { moodLine } from '../session/describe'
import { playSaved, saveCurrentSetup, sessionLink } from '../session/play'
import { copyText } from '../share/share'
import { useRadioStore } from '../store/useRadioStore'
import { DrawerRow, RowButton } from './DrawerRow'

const input =
  'min-w-0 flex-1 rounded-[3px] border border-black bg-black/60 px-2 py-1 font-read text-[14px] leading-none text-lcd shadow-[inset_0_1px_3px_#000] placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70'
const button =
  'flex items-center gap-1.5 rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2.5 py-1 font-term text-[15px] leading-none tracking-wider text-zinc-200 uppercase shadow-[0_2px_0_#000] hover:text-amber-300 disabled:opacity-40'

/** Named setups (a station and its mood), above the starred stations. */
export function SavedSetups() {
  const setups = useRadioStore((s) => s.library.setups)
  const playing = useRadioStore((s) => (s.tuneStatus === 'playing' ? s.station : null))
  const atmosphere = useRadioStore((s) => s.atmosphere)
  const removeSetup = useRadioStore((s) => s.removeSetup)
  const renameSetup = useRadioStore((s) => s.renameSetup)
  const showToast = useRadioStore((s) => s.showToast)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const save = (e: FormEvent) => {
    e.preventDefault()
    const saved = saveCurrentSetup(name || (atmosphere ? `${atmosphere.name} · ${playing?.name}` : (playing?.name ?? '')))
    if (saved) {
      setName('')
      showToast(`Saved “${saved.name}”`)
    }
  }

  return (
    <section aria-labelledby="setups-heading" className="flex flex-col gap-1.5">
      <h3 id="setups-heading" className="engraved font-term text-[13px] uppercase">Saved setups</h3>
      <form onSubmit={save} className="flex gap-1.5">
        <input
          className={input}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={playing ? 'Name this setup' : 'Play something to save it'}
          aria-label="Name for the current setup"
          disabled={!playing}
        />
        <button type="submit" className={button} disabled={!playing}>
          <Save size={14} /> Save
        </button>
      </form>
      {setups.length === 0 ? (
        <p className="p-1 font-read text-[13px] leading-snug text-zinc-400">
          A setup keeps the station with its weather, sky and sound mix, ready to come back to or share.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {setups.map((x) =>
            editing === x.id ? (
              <li key={x.id}>
                <form
                  className="flex gap-1.5 px-2 py-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (draft.trim()) renameSetup(x.id, draft.trim().slice(0, 40))
                    setEditing(null)
                  }}
                >
                  <input className={input} autoFocus value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} aria-label="New name" />
                  <button
                    type="submit"
                    aria-label="Save name"
                    className="grid size-7 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 text-zinc-200 hover:text-amber-300"
                  >
                    <Check size={14} />
                  </button>
                </form>
              </li>
            ) : (
              <DrawerRow
                key={x.id}
                title={x.name}
                subtitle={[x.setup.station.name, moodLine(x.setup)].filter(Boolean).join(' · ')}
                actions={
                  <>
                    <RowButton label={`Play ${x.name}`} onClick={() => void playSaved(x.setup)}>
                      <Play size={14} fill="currentColor" />
                    </RowButton>
                    <RowButton label={`Copy a link to ${x.name}`} onClick={() => void copyText(sessionLink(x.setup), 'Session link copied')}>
                      <Link size={14} />
                    </RowButton>
                    <RowButton
                      label={`Rename ${x.name}`}
                      onClick={() => {
                        setDraft(x.name)
                        setEditing(x.id)
                      }}
                    >
                      <Pencil size={13} />
                    </RowButton>
                    <RowButton label={`Delete ${x.name}`} onClick={() => removeSetup(x.id)}>
                      <Trash2 size={14} />
                    </RowButton>
                  </>
                }
              />
            ),
          )}
        </ul>
      )}
    </section>
  )
}
