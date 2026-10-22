import { Loader2, Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { searchStations } from '../../services/radioBrowser'
import { stationIndex } from '../../services/stationIndex'
import { useRadioStore } from '../../store/useRadioStore'
import type { Station } from '../../types'

/** Name search across the full Radio Browser catalogue, including stations with no map position. */
export function StationSearch() {
  const powered = useRadioStore((s) => s.powered)
  const requestStation = useRadioStore((s) => s.requestStation)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ query: string; results: Station[]; error: boolean; loading: boolean }>({
    query: '', results: [], error: false, loading: false,
  })
  const [retry, setRetry] = useState(0)
  const q = query.trim()
  const relevant = powered && search.query === q
  const results = relevant ? search.results : []
  const loading = powered && q.length >= 2 && (!relevant || search.loading)
  const error = relevant && search.error
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!powered || q.length < 2) return
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setSearch({ query: q, results: [], error: false, loading: true })
      searchStations(q, ctrl.signal)
        .then((list) => {
          if (ctrl.signal.aborted) return
          setSearch({ query: q, results: list, error: false, loading: false })
          setActive(0)
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setSearch({ query: q, results: [], error: true, loading: false })
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [q, powered, retry])

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const choose = (station: Station) => {
    stationIndex.add([station])
    // The index may have placed it approximately; tune the placed copy so the map can fly to it
    requestStation(stationIndex.get(station.id) ?? station, true)
    setOpen(false)
    setQuery('')
    setSearch({ query: '', results: [], error: false, loading: false })
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
      setOpen(false)
    }
  }

  const showList = powered && open && q.length >= 2

  return (
    <div ref={root} className="relative">
      <div className="flex items-center gap-2 rounded-[3px] border border-black bg-black/60 px-2 shadow-[inset_0_1px_3px_#000] focus-within:ring-2 focus-within:ring-amber-400/70">
        {loading ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-amber-300" />
        ) : (
          <Search size={14} className="shrink-0 text-zinc-500" />
        )}
        <input
          type="text"
          role="combobox"
          aria-label="Search all radio stations"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && !loading && results[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          placeholder={powered ? 'Search 50,000+ stations…' : 'Power on to search'}
          disabled={!powered}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
            if (e.target.value.trim() !== q) setSearch({ query: '', results: [], error: false, loading: false })
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent py-1 font-term text-[17px] leading-none text-lcd placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="text-zinc-500 hover:text-zinc-200">
            <X size={14} />
          </button>
        )}
      </div>
      {showList && (
        <div
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded-[3px] border border-black bg-[#0a120c] py-1 shadow-[0_8px_24px_rgb(0_0_0/0.7)]"
        >
          {error && !loading && (
            <div className="px-3 py-2 font-term text-[16px] text-hot">
              <span role="alert">Station search unavailable. </span>
              <button type="button" onClick={() => {
                setSearch({ query: q, results: [], error: false, loading: true })
                setRetry((value) => value + 1)
              }} className="underline focus-visible:ring-2 focus-visible:ring-amber-400">Retry search</button>
            </div>
          )}
          {loading && <div className="px-3 py-2 font-term text-[16px] text-lcd-dim" role="status">Searching…</div>}
          {results.length === 0 && !loading && !error && (
            <div className="px-3 py-2 font-term text-[16px] text-lcd-dim" role="status">No stations found</div>
          )}
          <ul id={listId} role="listbox" aria-label="Station search results">
            {results.map((s, i) => (
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
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
