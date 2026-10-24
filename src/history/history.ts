import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { isObject, safeStorage, useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'

export interface HistoryTrack {
  title: string
  /** When it was announced, ms since epoch */
  at: number
}

/** One stretch of listening to one station, with the songs it announced. */
export interface ListenSession {
  id: string
  station: Station
  startedAt: number
  endedAt: number
  tracks: HistoryTrack[]
}

export const MAX_SESSIONS = 200
export const MAX_HISTORY_TRACKS = 1000
/** Stations skipped past in less than this, with no songs, aren't worth a line */
const MIN_LISTEN_MS = 20_000
/** A drop-out and reconnect within this long continues the same session */
const RESUME_MS = 2 * 60_000

interface HistoryState {
  sessions: ListenSession[]
  clear: () => void
}

/** Kept apart from the settings (its own key), so a long history never slows them down. Not synced. */
export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      sessions: [],
      clear: () => set({ sessions: [] }),
    }),
    {
      name: 'pixel-radio.history',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ sessions: s.sessions }),
      merge: (saved, current) => ({ ...current, sessions: isObject(saved) ? sanitizeSessions(saved.sessions) : [] }),
    },
  ),
)

export function sanitizeSessions(v: unknown): ListenSession[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((x): ListenSession[] => {
    if (!isObject(x) || typeof x.id !== 'string' || typeof x.startedAt !== 'number' || typeof x.endedAt !== 'number') return []
    const st = x.station
    if (!isObject(st) || typeof st.id !== 'string' || typeof st.name !== 'string' || typeof st.url !== 'string') return []
    const tracks = Array.isArray(x.tracks)
      ? x.tracks.flatMap((t): HistoryTrack[] => (isObject(t) && typeof t.title === 'string' && typeof t.at === 'number' ? [{ title: t.title.slice(0, 120), at: t.at }] : []))
      : []
    return [{ id: x.id, station: st as unknown as Station, startedAt: x.startedAt, endedAt: x.endedAt, tracks }]
  }).slice(0, MAX_SESSIONS)
}

/** Newest first, within both caps: old sessions go first, then the oldest songs. */
function trim(sessions: ListenSession[]): ListenSession[] {
  const kept = sessions.slice(0, MAX_SESSIONS)
  let total = kept.reduce((n, s) => n + s.tracks.length, 0)
  for (let i = kept.length - 1; i >= 0 && total > MAX_HISTORY_TRACKS; i--) {
    const drop = Math.min(kept[i].tracks.length, total - MAX_HISTORY_TRACKS)
    kept[i] = { ...kept[i], tracks: kept[i].tracks.slice(drop) }
    total -= drop
  }
  return kept
}

/** Saved stations without the directory's day-to-day numbers. */
const lean = ({ trend: _trend, lastCheck: _lastCheck, ...station }: Station): Station => station

/**
 * Writes the listening history: a session per station you stay on, with every song it
 * announces. Buffering and reconnects to the same station continue the session.
 */
export class HistoryRecorder {
  private now: () => number
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(now = () => Date.now()) {
    this.now = now
  }

  connect() {
    this.timer = setInterval(this.touch, 30_000)
    this.sync()
    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (next.station !== prev.station || next.tuneStatus !== prev.tuneStatus || next.powered !== prev.powered) this.sync()
      if (next.nowPlaying !== prev.nowPlaying && next.nowPlaying) this.song(next.nowPlaying.stationId, next.nowPlaying.title)
    })
    return () => {
      clearInterval(this.timer)
      unsubscribe()
      this.touch()
    }
  }

  private update(fn: (sessions: ListenSession[]) => ListenSession[]) {
    useHistoryStore.setState((s) => ({ sessions: trim(fn(s.sessions)) }))
  }

  /** Extend the open session to now. */
  touch = () => {
    const s = useRadioStore.getState()
    const open = useHistoryStore.getState().sessions[0]
    if (!open || s.tuneStatus !== 'playing' || s.station?.id !== open.station.id) return
    const now = this.now()
    this.update(([first, ...rest]) => [{ ...first, endedAt: now }, ...rest])
  }

  private sync() {
    const s = useRadioStore.getState()
    const station = s.powered && s.tuneStatus === 'playing' && s.station?.source === 'radio-browser' ? s.station : null
    if (!station) return
    const now = this.now()
    const open = useHistoryStore.getState().sessions[0]
    if (open && open.station.id === station.id && now - open.endedAt < RESUME_MS) {
      this.update(([first, ...rest]) => [{ ...first, endedAt: now }, ...rest])
      return
    }
    this.update((sessions) => {
      // The station before was only skipped through
      const [last, ...older] = sessions
      const keep = last && (last.tracks.length || last.endedAt - last.startedAt >= MIN_LISTEN_MS) ? sessions : older
      return [{ id: `${now.toString(36)}-${station.id.slice(0, 8)}`, station: lean(station), startedAt: now, endedAt: now, tracks: [] }, ...keep]
    })
  }

  private song(stationId: string, title: string) {
    const open = useHistoryStore.getState().sessions[0]
    if (!open || open.station.id !== stationId || open.tracks.at(-1)?.title === title) return
    const now = this.now()
    this.update(([first, ...rest]) => [{ ...first, endedAt: now, tracks: [...first.tracks, { title, at: now }] }, ...rest])
  }
}

export const historyRecorder = new HistoryRecorder()
