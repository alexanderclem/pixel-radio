import { Dices, Loader2, Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { playFound, playSurprise, vibeSearch } from '../../discovery/discover'
import { qualityBadges } from '../../discovery/quality'
import { parseVibe } from '../../discovery/vibes'
import { searchStations } from '../../services/radioBrowser'
import { stationIndex } from '../../services/stationIndex'
import { useRadioStore } from '../../store/useRadioStore'
import type { Station } from '../../types'
import { QualityBadges } from '../DiscoverPanel'

interface SearchState {
  query: string
  /** Stations matching the vibe the words describe ("island", "upbeat cyberpunk") */
  vibes: Station[]
  results: Station[]
  /** Name matches the "Music only" switch hid */
  hidden: number
  error: boolean
  loading: boolean
}
const EMPTY: SearchState = { query: '', vibes: [], results: [], hidden: 0, error: false, loading: false }

/**
 * Search across the full Radio Browser catalogue, including stations with no map
 * position: by name, and by vibe when the words describe one.
 */
export function StationSearch() {
  const powered = useRadioStore((s) => s.powered)
  const searchNonce = useRadioStore((s) => s.searchNonce)
  const musicOnly = useRadioStore((s) => s.discovery.musicOnly)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchState>(EMPTY)
  const [retry, setRetry] = useState(0)
  const q = query.trim()
  const vibe = parseVibe(q)
  const relevant = powered && search.query === q
  const vibes = relevant ? search.vibes : []
  const names = relevant ? search.results : []
  const results = [...vibes, ...names]
  const loading = powered && q.length >= 2 && (!relevant || search.loading)
  const error = relevant && search.error
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // The "/" shortcut asks for the search box
  useEffect(() => {
    if (searchNonce) input.current?.focus()
  }, [searchNonce])

  useEffect(() => {
    if (!powered || q.length < 2) return
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setSearch({ ...EMPTY, query: q, loading: true })
      const known = parseVibe(q)
      void Promise.allSettled([
        searchStations(q, ctrl.signal),
        known.known ? vibeSearch(known, { signal: ctrl.signal, limit: 6 }) : Promise.resolve([]),
      ]).then(([byName, byVibe]) => {
        if (ctrl.signal.aborted) return
        if (byName.status === 'rejected' && (byVibe.status === 'rejected' || !known.known)) {
          setSearch({ ...EMPTY, query: q, error: true })
          return
        }
        const vibeList = byVibe.status === 'fulfilled' ? byVibe.value : []
        const shown = new Set(vibeList.map((s) => s.id))
        const all = byName.status === 'fulfilled' ? byName.value.filter((s) => !shown.has(s.id)) : []
        const kept = all.filter((s) => stationIndex.keeps(s))
        setSearch({ query: q, vibes: vibeList, results: kept, hidden: all.length - kept.length, error: false, loading: false })
        setActive(0)
      })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [q, powered, retry, musicOnly])

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const choose = (station: Station) => {
    playFound(station)
    setOpen(false)
    setQuery('')
    setSearch(EMPTY)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.max(0, Math.min(results.length - 1, a + 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' && open && !loading && results[active]) {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape') {
      if (!open) e.currentTarget.blur()
      setOpen(false)
    }
  }

  const showList = powered && open && q.length >= 2

  return (
    <div ref={root} className="relative flex items-center gap-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[3px] border border-black bg-black/60 px-2 shadow-[inset_0_1px_3px_#000] focus-within:ring-2 focus-within:ring-amber-400/70">
        {loading ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-amber-300" />
        ) : (
          <Search size={14} className="shrink-0 text-zinc-400" />
        )}
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Search all radio stations"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && !loading && results[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder={powered ? 'Search stations or a vibe…  ( / )' : 'Power on to search'}
          disabled={!powered}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
            if (e.target.value.trim() !== q) setSearch(EMPTY)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent py-1 font-term text-[17px] leading-none text-lcd placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-zinc-400 hover:text-zinc-200">
            <X size={14} />
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Surprise me: play a random station"
        title="Surprise me (R)"
        disabled={!powered}
        onClick={() => playSurprise()}
        className="grid size-[30px] shrink-0 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-700 to-zinc-900 text-zinc-300 shadow-[0_2px_0_#000] transition hover:text-amber-300 active:translate-y-0.5 active:shadow-none disabled:opacity-40"
      >
        <Dices size={15} />
      </button>
      {showList && (
        <div
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-[3px] border border-black bg-[#0a120c] py-1 shadow-[0_8px_24px_rgb(0_0_0/0.7)]"
        >
          {error && !loading && (
            <div className="px-3 py-2 font-term text-[16px] text-hot">
              <span role="alert">Station search unavailable. </span>
              <button type="button" onClick={() => {
                setSearch({ ...EMPTY, query: q, loading: true })
                setRetry((value) => value + 1)
              }} className="underline focus-visible:ring-2 focus-visible:ring-amber-400">Retry search</button>
            </div>
          )}
          {loading && <div className="px-3 py-2 font-term text-[16px] text-lcd-dim" role="status">Searching…</div>}
          {results.length === 0 && !loading && !error && (
            <div className="px-3 py-2 font-term text-[16px] text-lcd-dim" role="status">No stations found</div>
          )}
          <ul id={listId} role="listbox" aria-label="Station search results">
            {results.flatMap((s, i) => [
              i === 0 && vibes.length > 0 && (
                <li key="vibe-heading" role="presentation" className="px-3 pt-1 font-term text-[13px] tracking-widest text-amber-300/80 uppercase">
                  Vibe · {vibe.groups.map((g) => g.label).join(' + ')}
                </li>
              ),
              i === vibes.length && vibes.length > 0 && (
                <li key="name-heading" role="presentation" className="px-3 pt-1.5 font-term text-[13px] tracking-widest text-lcd-dim uppercase">
                  Named “{q}”
                </li>
              ),
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(s)}
                className={`cursor-pointer px-3 py-1 font-term leading-tight ${i === active ? 'bg-lcd/15' : ''}`}
              >
                <div className="truncate text-[17px] text-lcd">{s.name}</div>
                <div className="flex justify-between gap-2 text-[14px] text-lcd-dim">
                  <span className="truncate">
                    {s.lat === null ? '~' : ''}
                    {s.location}
                  </span>
                  <span className="shrink-0">
                    {s.codec}
                    {s.bitrate ? ` ${s.bitrate}K` : ''}
                    <QualityBadges badges={qualityBadges(s)} />
                  </span>
                </div>
              </li>,
            ])}
          </ul>
          {relevant && search.hidden > 0 && !loading && (
            <div className="px-3 pt-1 pb-0.5 font-read text-[12px] text-lcd-dim">
              {search.hidden} talk {search.hidden === 1 ? 'station' : 'stations'} hidden by Music only (W)
            </div>
          )}
        </div>
      )}
    </div>
  )
}
