import type { SavedTrack } from '../store/useRadioStore'
import type { Station } from '../types'

/** "Artist - Title" → its parts; titles without a separator are all title. */
export function splitTitle(title: string): { artist: string | null; track: string } {
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title.trim())
  return match ? { artist: match[1].trim(), track: match[2].trim() } : { artist: null, track: title.trim() }
}

/** Search pages for a song on the big streaming services; nothing to sign in to. */
export function findLinks(title: string): { label: string; url: string }[] {
  const q = encodeURIComponent(title.replace(/\s+[-–—]\s+/, ' '))
  return [
    { label: 'Spotify', url: `https://open.spotify.com/search/${q}` },
    { label: 'Apple Music', url: `https://music.apple.com/search?term=${q}` },
    { label: 'YouTube Music', url: `https://music.youtube.com/search?q=${q}` },
  ]
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export function tracksCsv(tracks: SavedTrack[]): string {
  const rows = tracks.map((t) => {
    const { artist, track } = splitTitle(t.title)
    return [artist ?? '', track, t.stationName, new Date(t.savedAt).toISOString()]
  })
  return [['Artist', 'Title', 'Heard on', 'Saved'], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export const tracksText = (tracks: SavedTrack[]) => tracks.map((t) => t.title).join('\n')

/** A playlist of stations other players (VLC, foobar2000…) can open. */
export function stationsM3u(stations: Station[]): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ')
  return ['#EXTM3U', ...stations.flatMap((s) => [`#EXTINF:-1,${clean(s.name)}`, clean(s.url)])].join('\n') + '\n'
}

/** Hand the listener a file. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
