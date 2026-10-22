import { Play, Trash2, X } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useRadioStore, type DrawerTab } from '../store/useRadioStore'
import type { Station } from '../types'

const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'favorites', label: 'Favorites' },
  { id: 'recent', label: 'Recent' },
]

/** Slide-in panel over the map: saved and recently played stations. */
export function StationsDrawer({ tab }: { tab: DrawerTab }) {
  const setDrawer = useRadioStore((s) => s.setDrawer)
  const library = useRadioStore((s) => s.library)
  const removeFavorite = useRadioStore((s) => s.removeFavorite)
  const removeRecent = useRadioStore((s) => s.removeRecent)

  return (
    <motion.aside
      aria-label="Stations"
      className="brushed fixed inset-y-0 right-0 z-40 flex w-[22rem] max-w-full flex-col gap-2 p-3"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.18 }}
    >
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="Station lists" className="flex overflow-hidden rounded-[3px] border border-black bg-black">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => setDrawer(t.id)}
              className={`border-r border-black px-3 py-1.5 font-term text-[15px] leading-none tracking-wide uppercase last:border-r-0 ${
                t.id === tab
                  ? 'bg-amber-400/90 text-black'
                  : 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-300 hover:text-amber-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Close panel"
          title="Close (Esc)"
          onClick={() => setDrawer(null)}
          className="grid size-8 place-items-center rounded-[3px] border border-black bg-zinc-800 text-zinc-300 hover:text-amber-300"
        >
          <X size={16} />
        </button>
      </div>

      <div role="tabpanel" className="module min-h-0 flex-1 overflow-y-auto rounded-md p-2">
        {tab === 'favorites' && (
          <StationList
            stations={library.favorites}
            empty="No favorites yet. Press ★ on the display (or S) while a station plays."
            onRemove={removeFavorite}
            removeLabel="Remove from favorites"
          />
        )}
        {tab === 'recent' && (
          <StationList stations={library.recents} empty="Stations you play show up here." onRemove={removeRecent} removeLabel="Remove from recents" />
        )}
      </div>
    </motion.aside>
  )
}

function StationList({ stations, empty, onRemove, removeLabel }: {
  stations: Station[]
  empty: string
  onRemove: (id: string) => void
  removeLabel: string
}) {
  const requestStation = useRadioStore((s) => s.requestStation)
  const playingId = useRadioStore((s) => s.station?.id)
  if (!stations.length) return <p className="p-2 font-term text-[17px] leading-tight text-zinc-500">{empty}</p>
  return (
    <ul className="flex flex-col gap-1">
      {stations.map((s) => (
        <DrawerRow
          key={s.id}
          title={s.name}
          subtitle={`${s.approx ? '~' : ''}${s.location}`}
          active={s.id === playingId}
          actions={
            <>
              <RowButton label={`Play ${s.name}`} onClick={() => requestStation(s, true)}>
                <Play size={14} fill="currentColor" />
              </RowButton>
              <RowButton label={`${removeLabel}: ${s.name}`} onClick={() => onRemove(s.id)}>
                <Trash2 size={14} />
              </RowButton>
            </>
          }
        />
      ))}
    </ul>
  )
}

export function DrawerRow({ title, subtitle, active, leading, actions }: {
  title: string
  subtitle: ReactNode
  active?: boolean
  leading?: ReactNode
  actions: ReactNode
}) {
  return (
    <li className={`flex items-center gap-2 rounded-[3px] px-2 py-1.5 ${active ? 'bg-lcd/10' : 'hover:bg-white/5'}`}>
      {leading}
      <div className="min-w-0 flex-1 font-term leading-tight">
        <div className={`truncate text-[17px] ${active ? 'text-lcd' : 'text-zinc-200'}`}>{title}</div>
        <div className="truncate text-[14px] text-zinc-500">{subtitle}</div>
      </div>
      <div className="flex shrink-0 gap-1">{actions}</div>
    </li>
  )
}

export function RowButton({ label, onClick, disabled, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-7 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 text-zinc-200 shadow-[0_1px_0_#000] hover:text-amber-300 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
