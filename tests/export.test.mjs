import { test } from 'node:test'
import assert from 'node:assert/strict'
import { station } from './helpers.mjs'
import { splitTitle, findLinks, tracksCsv, stationsM3u } from '../src/export/tracks.ts'
import { authorizeUrl, challengeFor, createPlaylist, makeVerifier } from '../src/export/spotify.ts'

test('titles split into artist and track', () => {
  assert.deepEqual(splitTitle('Daft Punk - One More Time'), { artist: 'Daft Punk', track: 'One More Time' })
  assert.deepEqual(splitTitle('Sigur Rós – Hoppípolla'), { artist: 'Sigur Rós', track: 'Hoppípolla' })
  assert.deepEqual(splitTitle('Untitled-1'), { artist: null, track: 'Untitled-1' })
})

test('search links, CSV and M3U are well formed', () => {
  const links = findLinks('A & B - C?')
  assert.deepEqual(links.map((l) => l.label), ['Spotify', 'Apple Music', 'YouTube Music'])
  assert.ok(links.every((l) => l.url.startsWith('https://') && !l.url.includes(' ')))
  const csv = tracksCsv([{ id: '1', title: 'X, "Y" - Z', stationName: 'FM', stationId: 's', savedAt: 0 }])
  assert.equal(csv, 'Artist,Title,Heard on,Saved\r\n"X, ""Y""",Z,FM,1970-01-01T00:00:00.000Z\r\n')
  const m3u = stationsM3u([station('a', { name: 'Line\nbreak' })])
  assert.equal(m3u, '#EXTM3U\n#EXTINF:-1,Line break\nhttps://example.test/a\n')
})

test('PKCE verifier and S256 challenge follow RFC 7636', async () => {
  const verifier = makeVerifier()
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/)
  // The RFC's own example
  assert.equal(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  const url = new URL(authorizeUrl('chal', 'st', 'https://pixelradios.com'))
  assert.equal(url.origin, 'https://accounts.spotify.com')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://pixelradios.com/spotify-callback')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('scope'), 'playlist-modify-private')
})

test('a playlist gets the songs Spotify finds, and a failed lookup skips just that song', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method ?? 'GET', url, init.body])
    const json = (data) => ({ ok: true, json: async () => data })
    if (url.endsWith('/me')) return json({ id: 'me' })
    if (url.includes('/search')) {
      if (url.includes('broken')) return { ok: false, status: 500 }
      return json({ tracks: { items: url.includes('nothing') ? [] : [{ uri: `spotify:track:${calls.length}` }] } })
    }
    if (url.endsWith('/users/me/playlists')) return json({ id: 'pl', external_urls: { spotify: 'https://open.spotify.com/playlist/pl' } })
    return json({})
  }
  const tracks = ['A - One', 'nothing here', 'broken', 'B - Two'].map((title, i) => ({ id: String(i), title, stationId: 's', stationName: 'S', savedAt: 0 }))
  const result = await createPlaylist('token', tracks, fetchImpl)
  assert.deepEqual(result, { found: 2, total: 4, url: 'https://open.spotify.com/playlist/pl' })
  const search = calls.find(([, url]) => url.includes('/search'))[1]
  assert.match(decodeURIComponent(search), /track:One artist:A/)
  const add = calls.find(([, url]) => url.endsWith('/playlists/pl/tracks'))
  assert.equal(JSON.parse(add[2]).uris.length, 2)
  assert.equal(JSON.parse(calls.find(([, url]) => url.endsWith('/users/me/playlists'))[2]).public, false)
})
