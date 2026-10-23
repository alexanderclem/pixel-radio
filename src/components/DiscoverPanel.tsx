import { Dices, Loader2, Play, Search, Star, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { nearbyCountry, filteredSearch, playFound, playSurprise, similarTo, trending, vibeSearch } from '../discovery/discover'
import { toggleMusicOnly } from '../discovery/musicOnly'
import { qualityBadges, type Badge } from '../discovery/quality'
import { parseVibe, VIBE_EXAMPLES } from '../discovery/vibes'
import { fetchFacets, type Facet } from '../services/radioBrowser'
import { useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { ToggleSwitch } from './deck/ToggleSwitch'
import { button, DrawerRow, input, RowButton } from './DrawerRow'

const heading = 'engraved font-term text-[13px] uppercase'
const select =
  'min-w-0 flex-1 rounded-[3px] border border-black bg-black/60 px-1.5 py-1 font-term text-[15px] leading-none text-lcd shadow-[inset_0_1px_3px_#000] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70'

/** Genres for the filter menu, as Radio Browser tags. */
const GENRES = [
  'ambient', 'blues', 'bossa nova', 'chillout', 'classical', 'country', 'dance', 'disco', 'drum and bass', 'edm', 'folk',
  'funk', 'hip hop', 'house', 'indie', 'jazz', 'k-pop', 'latin', 'lofi', 'lounge', 'metal', 'oldies', 'pop', 'punk',
  'reggae', 'rnb', 'rock', 'salsa', 'soul', 'soundtrack', 'synthwave', 'techno', 'trance', 'world music', '80s', '90s',
]

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' })
  } catch {
    return null
  }
})()

type Load = { key: string; stations: Station[]; loading: boolean; error: boolean }
const idle: Load = { key: '', stations: [], loading: false, error: false }

/** Runs a station lookup whenever `key` changes; cancels the previous one. */
function useLookup(key: string | null, run: (signal: AbortSignal) => Promise<Station[]>, delay = 0): Load {
  const [state, setState] = useState<Load>(idle)
  useEffect(() => {
    if (key === null) return
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setState({ key, stations: [], loading: true, error: false })
      run(ctrl.signal)
        .then((stations) => !ctrl.signal.aborted && setState({ key, stations, loading: false, error: false }))
        .catch(() => !ctrl.signal.aborted && setState({ key, stations: [], loading: false, error: true }))
    }, delay)
    return () => {
      window.clearTimeout(timer)
      ctrl.abort()
    }
    // `run` is rebuilt every render; `key` says when the lookup really changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return key !== null && state.key === key ? state : { ...idle, loading: key !== null }
}

function useFacets(kind: 'languages' | 'countries') {
  const [facets, setFacets] = useState<Facet[]>([])
  useEffect(() => {
    let live = true
    fetchFacets(kind).then((list) => live && setFacets(list)).catch(() => {})
    return () => {
      live = false
    }
  }, [kind])
  return facets
}

/**
 * Find stations by vibe ("island", "upbeat cyberpunk"), genre, language or country;
 * see what's like the station on now and what's rising; or let it surprise you.
 */
export function DiscoverPanel() {
  const playing = useRadioStore((s) => (s.station?.source === 'radio-browser' ? s.station : null))
  const musicOnly = useRadioStore((s) => s.discovery.musicOnly)
  const powered = useRadioStore((s) => s.powered)
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState('')
  const [language, setLanguage] = useState('')
  const [country, setCountry] = useState('')
  const [scope, setScope] = useState<'world' | 'near'>('world')
  const languages = useFacets('languages')
  const countries = useFacets('countries')

  const q = query.trim()
  const vibe = parseVibe(q)
  const searching = q.length >= 2 || !!genre || !!language || !!country
  const searchKey = searching ? JSON.stringify([q, genre, language, country, musicOnly]) : null
  const results = useLookup(searchKey, async (signal) => {
    // A known vibe reads the words as moods; anything else is a name, then tags as a fallback
    if (vibe.known && !genre) {
      const found = await vibeSearch(vibe, { signal, limit: 60 })
      return found
        .filter((s) => !country || s.country === country)
        .filter((s) => !language || (s.language ?? '').includes(language))
        .slice(0, 40)
    }
    const byName = await filteredSearch({ name: q || undefined, tag: genre || undefined, language: language || undefined, countryCode: country || undefined }, { signal })
    if (byName.length || !q || genre || language || country) return byName
    return vibeSearch(vibe, { signal })
  }, 350)

  const similar = useLookup(!searching && playing ? `${playing.id}:${musicOnly}` : null, (signal) => similarTo(playing!, { signal }))
  const near = scope === 'near' ? nearbyCountry() : null
  const rising = useLookup(searching ? null : `${scope}:${near}:${musicOnly}`, (signal) => trending(near, { signal }))
  const nearLabel = near ? (regionNames?.of(near) ?? near) : 'near you'

  const surpriseFrom = searching && results.stations.length ? results.stations : undefined

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Search by vibe" className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[3px] border border-black bg-black/60 px-2 shadow-[inset_0_1px_3px_#000] focus-within:ring-2 focus-within:ring-amber-400/70">
            {results.loading && searching ? <Loader2 size={14} className="shrink-0 animate-spin text-amber-300" /> : <Search size={14} className="shrink-0 text-zinc-500" />}
            <input
              type="search"
              aria-label="Search by vibe, genre or name"
              placeholder="A vibe: island, upbeat cyberpunk…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${input} border-0 bg-transparent px-0 shadow-none focus-visible:ring-0`}
            />
            {query && (
              <button type="button" aria-label="Clear" onClick={() => setQuery('')} className="text-zinc-500 hover:text-zinc-200">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={button}
            disabled={!powered}
            title={powered ? 'Play a random station (R)' : 'Power on first'}
            onClick={() => playSurprise(surpriseFrom)}
          >
            <Dices size={14} /> {surpriseFrom ? 'From these' : 'Surprise'}
          </button>
        </div>
        {!q && (
          <div className="flex flex-wrap gap-1" aria-label="Try a vibe">
            {VIBE_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuery(example)}
                className="rounded-full border border-black/70 bg-black/30 px-2 py-0.5 font-read text-[12px] text-zinc-300 hover:text-amber-300"
              >
                {example}
              </button>
            ))}
          </div>
        )}
        {vibe.known && q && (
          <p className="font-read text-[12px] leading-snug text-zinc-400">
            Vibe: {vibe.groups.map((g) => g.label).join(' + ')}
          </p>
        )}
        <div className="flex gap-1.5">
          <select aria-label="Genre" className={select} value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="">Any genre</option>
            {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select aria-label="Language" className={select} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">Any language</option>
            {languages.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <select aria-label="Country" className={select} value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Anywhere</option>
            {countries.map((c) => <option key={c.value} value={c.value}>{regionNames?.of(c.value) ?? c.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <ToggleSwitch label="Music only" checked={musicOnly} onChange={toggleMusicOnly} />
          <span className="font-read text-[12px] leading-snug text-zinc-500">Hides talk, news &amp; sports (W)</span>
        </div>
      </section>

      {searching ? (
        <Section title="Results" load={results} empty={musicOnly ? 'Nothing found. Music only is on, so talk stations are hidden.' : 'Nothing found. Try another vibe or fewer filters.'} />
      ) : (
        <>
          {playing && <Section title={`More like ${playing.name}`} load={similar} empty="Nothing similar found yet." />}
          <Section
            title="Trending"
            load={rising}
            empty="Nothing trending right now."
            extra={
              <div role="radiogroup" aria-label="Trending where" className="flex overflow-hidden rounded-[3px] border border-black bg-black">
                {(['world', 'near'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={scope === value}
                    onClick={() => setScope(value)}
                    className={`px-1.5 py-0.5 font-term text-[12px] leading-none uppercase ${scope === value ? 'bg-amber-400/90 text-black' : 'bg-zinc-800 text-zinc-300 hover:text-amber-200'}`}
                  >
                    {value === 'world' ? 'World' : nearLabel}
                  </button>
                ))}
              </div>
            }
          />
        </>
      )}
    </div>
  )
}

function Section({ title, load, empty, extra }: { title: string; load: Load; empty: string; extra?: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className={`${heading} truncate`}>{title}</h3>
        {extra}
      </div>
      {load.loading ? (
        <p className="p-1 font-read text-[13px] text-zinc-500" role="status">Looking…</p>
      ) : load.error ? (
        <p className="p-1 font-read text-[13px] text-hot" role="alert">The station directory didn't answer. Try again in a moment.</p>
      ) : load.stations.length ? (
        <StationResults stations={load.stations} />
      ) : (
        <p className="p-1 font-read text-[13px] leading-snug text-zinc-500">{empty}</p>
      )}
    </section>
  )
}

/** Found stations with what to expect from each, to play or star. */
export function StationResults({ stations }: { stations: Station[] }) {
  const playingId = useRadioStore((s) => s.station?.id)
  const favorites = useRadioStore((s) => s.library.favorites)
  const toggleFavorite = useRadioStore((s) => s.toggleFavorite)
  const powered = useRadioStore((s) => s.powered)
  return (
    <ul className="flex flex-col gap-1">
      {stations.map((s) => {
        const starred = favorites.some((f) => f.id === s.id)
        return (
          <DrawerRow
            key={s.id}
            title={s.name}
            subtitle={
              <>
                {s.lat === null ? '~' : ''}
                {s.location}
                <QualityBadges badges={qualityBadges(s)} />
              </>
            }
            active={s.id === playingId}
            actions={
              <>
                <RowButton label={`${starred ? 'Unstar' : 'Star'} ${s.name}`} onClick={() => toggleFavorite(s)}>
                  <Star size={14} fill={starred ? 'currentColor' : 'none'} />
                </RowButton>
                <RowButton label={`Play ${s.name}`} disabled={!powered} onClick={() => playFound(s)}>
                  <Play size={14} fill="currentColor" />
                </RowButton>
              </>
            }
          />
        )
      })}
    </ul>
  )
}

const TONE: Record<Badge['tone'], string> = {
  good: 'border-lcd/50 text-lcd',
  warn: 'border-hot/60 text-hot',
  dim: 'border-zinc-600 text-zinc-400',
}

export function QualityBadges({ badges }: { badges: Badge[] }) {
  if (!badges.length) return null
  return (
    <>
      {badges.map((b) => (
        <span key={b.label} title={b.title} className={`ml-1.5 inline-block rounded-[2px] border px-1 align-[1px] font-term text-[11px] leading-[1.1] ${TONE[b.tone]}`}>
          {b.label}
        </span>
      ))}
    </>
  )
}
