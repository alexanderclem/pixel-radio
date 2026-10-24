import { Download, Play, Trash2, UserRound, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useRadioStore, type DrawerTab } from '../store/useRadioStore'
import type { Station } from '../types'
import { AccountPanel } from './AccountPanel'
import { AvatarEditor } from './AvatarEditor'
import { DiscoverPanel } from './DiscoverPanel'
import { download, stationsM3u } from '../export/tracks'
import { button, DrawerRow, RowButton } from './DrawerRow'
import { HistoryPanel } from './HistoryPanel'
import { FriendsPanel } from './FriendsPanel'
import { MoodsPanel } from './MoodsPanel'
import { PassportPanel } from './PassportPanel'
import { SavedSetups } from './SavedSetups'

const TABS: { id: DrawerTab; label: string; icon?: typeof UserRound }[] = [
  { id: 'discover', label: 'Discover' },
  { id: 'moods', label: 'Moods' },
  { id: 'favorites', label: 'Saved' },
  { id: 'recent', label: 'History' },
  { id: 'friends', label: 'Friends' },
  { id: 'avatar', label: 'Avatar' },
  { id: 'passport', label: 'Passport' },
  // Icon only, to keep the tab row short
  { id: 'account', label: 'Account', icon: UserRound },
]

/** Slide-in panel over the map: saved and recently played stations, and friends. */
export function StationsDrawer({ tab }: { tab: DrawerTab }) {
  const setDrawer = useRadioStore((s) => s.setDrawer)
  const library = useRadioStore((s) => s.library)
  const removeFavorite = useRadioStore((s) => s.removeFavorite)

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
        <div role="tablist" aria-label="Station lists" className="flex flex-wrap gap-px overflow-hidden rounded-[3px] border border-black bg-black">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => setDrawer(t.id)}
              aria-label={t.icon ? t.label : undefined}
              title={t.icon ? `${t.label} (U)` : undefined}
              className={`px-2 py-1.5 font-term text-[14px] leading-none tracking-wide uppercase ${
                t.id === tab
                  ? 'bg-amber-400/90 text-black'
                  : 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-300 hover:text-amber-200'
              }`}
            >
              {t.icon ? <t.icon size={14} /> : t.label}
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
        {tab === 'discover' && <DiscoverPanel />}
        {tab === 'moods' && <MoodsPanel />}
        {tab === 'favorites' && (
          <div className="flex flex-col gap-4">
            <SavedSetups />
            <section aria-labelledby="starred-heading" className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <h3 id="starred-heading" className="engraved font-term text-[13px] uppercase">Starred stations</h3>
                {library.favorites.length > 0 && (
                  <button
                    type="button"
                    className={button}
                    title="A playlist of your starred stations for other players, like VLC"
                    onClick={() => download('pixel-radio-stations.m3u', stationsM3u(library.favorites), 'audio/x-mpegurl')}
                  >
                    <Download size={13} /> .m3u
                  </button>
                )}
              </div>
              <StationList
                stations={library.favorites}
                empty="No starred stations yet. Press ★ on the display (or S) while a station plays."
                onRemove={removeFavorite}
                removeLabel="Remove from favorites"
              />
            </section>
          </div>
        )}
        {tab === 'recent' && <HistoryPanel />}
        {tab === 'friends' && <FriendsPanel />}
        {tab === 'avatar' && <AvatarEditor />}
        {tab === 'passport' && <PassportPanel />}
        {tab === 'account' && <AccountPanel />}
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
  if (!stations.length) return <p className="p-1 font-read text-[13px] leading-snug text-zinc-500">{empty}</p>
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
