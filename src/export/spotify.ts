import type { SavedTrack } from '../store/useRadioStore'
import { useRadioStore } from '../store/useRadioStore'
import { splitTitle } from './tracks'

/**
 * "Create Spotify playlist" for saved songs: Authorization Code with PKCE straight from
 * the browser (no secret, no server). Only offered when the build sets
 * VITE_SPOTIFY_CLIENT_ID; the token lives in sessionStorage for this tab only.
 */
export const SPOTIFY_CLIENT_ID: string = import.meta.env?.VITE_SPOTIFY_CLIENT_ID ?? ''
export const SPOTIFY_CALLBACK = '/spotify-callback'
const AUTH = 'https://accounts.spotify.com/authorize'
const TOKEN = 'https://accounts.spotify.com/api/token'
const API = 'https://api.spotify.com/v1'
const PENDING_KEY = 'pixel-radio.spotify'
const SCOPE = 'playlist-modify-private'

export const spotifyEnabled = () => SPOTIFY_CLIENT_ID !== ''

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A random PKCE verifier (43–128 characters from the allowed set). */
export function makeVerifier(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return base64url(random(48))
}

export async function challengeFor(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

export const redirectUri = (origin = location.origin) => `${origin}${SPOTIFY_CALLBACK}`

export function authorizeUrl(challenge: string, state: string, origin?: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPE,
    redirect_uri: redirectUri(origin),
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })
  return `${AUTH}?${q}`
}

interface Pending {
  verifier: string
  state: string
  tracks: SavedTrack[]
}

/** Step 1, from a click: remember the songs and go to Spotify to sign in. */
export async function startSpotifyExport(tracks: SavedTrack[]) {
  const verifier = makeVerifier()
  const state = makeVerifier().slice(0, 16)
  const pending: Pending = { verifier, state, tracks }
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  location.assign(authorizeUrl(await challengeFor(verifier), state))
}

type Fetch = typeof fetch

async function api<T>(fetchImpl: Fetch, token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchImpl(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new Error(`Spotify said ${res.status}`)
  return (await res.json()) as T
}

/** Find each song on Spotify and put the matches in a new private playlist. */
export async function createPlaylist(token: string, tracks: SavedTrack[], fetchImpl: Fetch = (...a) => fetch(...a)) {
  const me = await api<{ id: string }>(fetchImpl, token, '/me')
  const uris: string[] = []
  for (const t of tracks) {
    const { artist, track } = splitTitle(t.title)
    const q = artist ? `track:${track} artist:${artist}` : track
    try {
      const found = await api<{ tracks?: { items?: { uri?: string }[] } }>(fetchImpl, token, `/search?type=track&limit=1&q=${encodeURIComponent(q)}`)
      const uri = found.tracks?.items?.[0]?.uri
      if (uri && !uris.includes(uri)) uris.push(uri)
    } catch {
      // One song that can't be looked up doesn't stop the rest
    }
  }
  const playlist = await api<{ id: string; external_urls?: { spotify?: string } }>(fetchImpl, token, `/users/${encodeURIComponent(me.id)}/playlists`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Pixel Radio · saved songs', public: false, description: 'Songs saved while listening on pixelradios.com' }),
  })
  for (let i = 0; i < uris.length; i += 100) {
    await api(fetchImpl, token, `/playlists/${playlist.id}/tracks`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100) }) })
  }
  return { found: uris.length, total: tracks.length, url: playlist.external_urls?.spotify ?? null }
}

/**
 * Step 2, when the page opens at /spotify-callback: trade the code for a token, build the
 * playlist and tidy the address. Does nothing on any other page.
 */
export async function finishSpotifyExport(loc: Pick<Location, 'pathname' | 'search' | 'origin'> = location, fetchImpl: Fetch = (...a) => fetch(...a)) {
  if (loc.pathname !== SPOTIFY_CALLBACK) return
  const params = new URLSearchParams(loc.search)
  try {
    history.replaceState(null, '', '/')
  } catch {
    // Sandboxed frames may refuse
  }
  const store = useRadioStore.getState()
  let pending: Pending | null = null
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as Pending | null
  } catch {
    pending = null
  }
  sessionStorage.removeItem(PENDING_KEY)
  const code = params.get('code')
  if (!pending || !code || params.get('state') !== pending.state) {
    store.showToast(params.get('error') === 'access_denied' ? 'Spotify export cancelled' : "Spotify export didn't finish. Try again from History.")
    return
  }
  try {
    store.showToast('Making your Spotify playlist…')
    const res = await fetchImpl(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(loc.origin),
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: pending.verifier,
      }),
    })
    if (!res.ok) throw new Error(`token ${res.status}`)
    const { access_token: token } = (await res.json()) as { access_token?: string }
    if (!token) throw new Error('no token')
    const result = await createPlaylist(token, pending.tracks, fetchImpl)
    useRadioStore.getState().showToast(`Spotify playlist made: ${result.found} of ${result.total} songs found`)
    return result
  } catch {
    useRadioStore.getState().showToast("Couldn't make the Spotify playlist. Try again later.")
  }
}
