import { Copy, Download, Heart, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { spotifyEnabled, startSpotifyExport } from '../export/spotify'
import { download, findLinks, tracksCsv, tracksText } from '../export/tracks'
import { useHistoryStore, type ListenSession } from '../history/history'
import { copyText } from '../share/share'
import { trackId, useRadioStore, type SavedTrack } from '../store/useRadioStore'
import type { Station } from '../types'
import { button, DrawerRow, RowButton } from './DrawerRow'

const heading = 'engraved font-term text-[13px] uppercase'
const link = 'underline decoration-dotted underline-offset-2 hover:text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-400'

const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
function dayLabel(ms: number) {
  const d = new Date(ms)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Save or unsave a song, from anywhere it's shown. */
export function SaveSongButton({ title, station, className }: { title: string; station: Pick<Station, 'id' | 'name'>; className?: string }) {
  const saved = useRadioStore((s) => s.library.tracks.some((t) => t.id === trackId(title)))
  const toggleTrack = useRadioStore((s) => s.toggleTrack)
  const label = saved ? `Forget “${title}”` : `Save “${title}”`
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={label}
      title={`${saved ? 'Saved · click to forget' : 'Save this song'} (K)`}
      onClick={() => toggleTrack({ title, stationId: station.id, stationName: station.name })}
      className={className ?? `grid size-6 shrink-0 place-items-center rounded-[3px] hover:text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-400 ${saved ? 'text-hot' : 'text-zinc-400'}`}
    >
      <Heart size={13} fill={saved ? 'currentColor' : 'none'} />
    </button>
  )
}

/** History tab: songs you saved, what you listened to and when, and recent stations. */
export function HistoryPanel() {
  const tracks = useRadioStore((s) => s.library.tracks)
  const recents = useRadioStore((s) => s.library.recents)
  const removeRecent = useRadioStore((s) => s.removeRecent)
  const sessions = useHistoryStore((s) => s.sessions)
  const clear = useHistoryStore((s) => s.clear)
  const [confirmClear, setConfirmClear] = useState(false)

  const days: { label: string; sessions: ListenSession[] }[] = []
  for (const session of sessions) {
    const label = dayLabel(session.startedAt)
    const day = days.at(-1)
    if (day?.label === label) day.sessions.push(session)
    else days.push({ label, sessions: [session] })
  }

  return (
    <div className="flex flex-col gap-4">
      <SavedSongs tracks={tracks} />

      <section aria-labelledby="history-heading" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 id="history-heading" className={heading}>Listening history</h3>
          {sessions.length > 0 && (
            confirmClear ? (
              <span className="flex gap-1">
                <button type="button" className={button} onClick={() => { clear(); setConfirmClear(false) }}>Clear all</button>
                <button type="button" className={button} onClick={() => setConfirmClear(false)}>Keep</button>
              </span>
            ) : (
              <button type="button" className={button} onClick={() => setConfirmClear(true)}>
                <Trash2 size={13} /> Clear
              </button>
            )
          )}
        </div>
        {sessions.length === 0 ? (
          <p className="p-1 font-read text-[13px] leading-snug text-zinc-400">
            Stations you listen to show up here with the time, and the songs they announce. It stays on this device.
          </p>
        ) : (
          days.map((day) => (
            <div key={day.label} className="flex flex-col gap-1">
              <h4 className="px-1 font-term text-[13px] tracking-wider text-zinc-400 uppercase">{day.label}</h4>
              <ul className="flex flex-col gap-1">
                {day.sessions.map((s) => <SessionRow key={s.id} session={s} />)}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="recent-heading" className="flex flex-col gap-1.5">
        <h3 id="recent-heading" className={heading}>Recent stations</h3>
        {recents.length === 0 ? (
          <p className="p-1 font-read text-[13px] leading-snug text-zinc-400">Stations you play show up here, on every device you sign in on.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {recents.map((s) => (
              <StationLine key={s.id} station={s} subtitle={`${s.approx ? '~' : ''}${s.location}`} onRemove={() => removeRecent(s.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StationLine({ station, subtitle, onRemove }: { station: Station; subtitle: string; onRemove?: () => void }) {
  const requestStation = useRadioStore((s) => s.requestStation)
  const playingId = useRadioStore((s) => s.station?.id)
  const powered = useRadioStore((s) => s.powered)
  return (
    <DrawerRow
      title={station.name}
      subtitle={subtitle}
      active={station.id === playingId}
      actions={
        <>
          <RowButton label={`Play ${station.name}`} disabled={!powered} onClick={() => requestStation(station, true)}>
            <Play size={14} fill="currentColor" />
          </RowButton>
          {onRemove && (
            <RowButton label={`Remove ${station.name} from recents`} onClick={onRemove}>
              <Trash2 size={14} />
            </RowButton>
          )}
        </>
      }
    />
  )
}

function SessionRow({ session }: { session: ListenSession }) {
  const minutes = Math.round((session.endedAt - session.startedAt) / 60_000)
  const span = `${clock(session.startedAt)}${minutes >= 1 ? ` · ${minutes} min` : ''} · ${session.station.location}`
  return (
    <>
      <StationLine station={session.station} subtitle={span} />
      {session.tracks.length > 0 && (
        <li className="-mt-0.5 mb-1 pl-4">
          <ul className="flex flex-col border-l border-zinc-700 pl-2">
            {session.tracks.map((t) => (
              <li key={`${t.at}-${t.title}`} className="flex items-center gap-1 font-read text-[13px] leading-snug text-zinc-300">
                <span className="w-14 shrink-0 text-[12px] text-zinc-400 tabular-nums">{clock(t.at)}</span>
                <span className="min-w-0 flex-1 truncate" title={t.title}>{t.title}</span>
                <SaveSongButton title={t.title} station={session.station} />
              </li>
            ))}
          </ul>
        </li>
      )}
    </>
  )
}

function SavedSongs({ tracks }: { tracks: SavedTrack[] }) {
  const removeTrack = useRadioStore((s) => s.removeTrack)
  return (
    <section aria-labelledby="songs-heading" className="flex flex-col gap-1.5">
      <h3 id="songs-heading" className={heading}>Saved songs</h3>
      {tracks.length === 0 ? (
        <p className="p-1 font-read text-[13px] leading-snug text-zinc-400">
          When a station announces a song, press <Heart size={11} className="inline align-[-1px]" /> next to it (or K) to keep it here.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={button} onClick={() => void copyText(tracksText(tracks), 'Song list copied')}>
              <Copy size={13} /> Copy
            </button>
            <button type="button" className={button} onClick={() => download('pixel-radio-songs.csv', tracksCsv(tracks), 'text/csv')}>
              <Download size={13} /> CSV
            </button>
            {spotifyEnabled() && (
              <button type="button" className={button} onClick={() => void startSpotifyExport(tracks)} title="Sign in to Spotify and make a private playlist of these songs">
                Spotify playlist
              </button>
            )}
          </div>
          <ul className="flex flex-col gap-1">
            {tracks.map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-[3px] px-2 py-1.5 hover:bg-white/5">
                <div className="min-w-0 flex-1 font-read leading-tight">
                  <div className="truncate text-[14px] font-medium text-zinc-200" title={t.title}>{t.title}</div>
                  <div className="truncate text-[12px] text-zinc-400">
                    {t.stationName && `${t.stationName} · `}
                    {findLinks(t.title).map((l, i) => (
                      <span key={l.label}>
                        {i > 0 && ' · '}
                        <a href={l.url} target="_blank" rel="noopener noreferrer" className={link}>{l.label}</a>
                      </span>
                    ))}
                  </div>
                </div>
                <RowButton label={`Forget “${t.title}”`} onClick={() => removeTrack(t.id)}>
                  <Trash2 size={14} />
                </RowButton>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
