import { useAdReplacement } from '../src/audio/AdReplacement.ts'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle, icyTitleFromBytes, parseIcecastStatus, parseIcyMetadata, parseId3Title } from '../src/nowplaying/parse.ts'
import { adReplacement, NowPlaying } from '../src/nowplaying/NowPlaying.ts'
import { nowPlaying as workerNowPlaying, readIcyTitle, streamUrl } from '../worker/src/nowplaying.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { flush, station } from './helpers.mjs'

const enc = (s) => new TextEncoder().encode(s)

test('titles are cleaned and placeholders dropped', () => {
  assert.equal(cleanTitle('  Daft  Punk - One More Time \u0000'), 'Daft Punk - One More Time')
  for (const junk of ['', ' - ', 'Unknown', 'LIVE', null, 42]) assert.equal(cleanTitle(junk), null)
  assert.equal(cleanTitle('Jazz FM', 'jazz fm'), null, 'station repeating its own name')
  assert.equal(cleanTitle('x'.repeat(300)).length, 120)
})

test('ICY metadata: block parsing, apostrophes, Latin-1, and reading through the interval', () => {
  assert.equal(parseIcyMetadata("StreamTitle='Artist - Song';StreamUrl='';"), 'Artist - Song')
  assert.equal(parseIcyMetadata("StreamTitle='Guns N' Roses - Don't Cry';"), "Guns N' Roses - Don't Cry")
  assert.equal(parseIcyMetadata(new Uint8Array([...enc("StreamTitle='Beyonc"), 0xe9, ...enc("';")])), 'Beyoncé')
  assert.equal(parseIcyMetadata("StreamTitle='';"), null)

  const meta = enc("StreamTitle='Air - La Femme';")
  const padded = new Uint8Array(Math.ceil(meta.length / 16) * 16)
  padded.set(meta)
  const audio = new Uint8Array(32)
  const bytes = new Uint8Array([...audio, padded.length / 16, ...padded])
  assert.equal(icyTitleFromBytes(bytes.subarray(0, 20), 32), undefined, 'needs more audio bytes')
  assert.equal(icyTitleFromBytes(bytes.subarray(0, 40), 32), undefined, 'needs the rest of the block')
  assert.equal(icyTitleFromBytes(bytes, 32), 'Air - La Femme')
  assert.equal(icyTitleFromBytes(new Uint8Array([...audio, 0]), 32), null, 'empty block')
})

function id3(frames) {
  const body = frames.flatMap(([id, payload]) => {
    const size = payload.length
    return [...enc(id), (size >> 24) & 255, (size >> 16) & 255, (size >> 8) & 255, size & 255, 0, 0, ...payload]
  })
  const n = body.length
  return new Uint8Array([...enc('ID3'), 3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127, ...body])
}

test('ID3 (HLS) titles: TPE1/TIT2, UTF-16, and StreamTitle in TXXX', () => {
  assert.equal(parseId3Title(id3([['TPE1', [3, ...enc('Nils Frahm')]], ['TIT2', [3, ...enc('Says')]]])), 'Nils Frahm - Says')
  const utf16 = [1, 0xff, 0xfe, ...[...'Café'].flatMap((c) => [c.charCodeAt(0), 0])]
  assert.equal(parseId3Title(id3([['TIT2', utf16]])), 'Café')
  assert.equal(parseId3Title(id3([['TXXX', [0, ...enc("\0StreamTitle='Bonobo - Kerala';")]]])), 'Bonobo - Kerala')
  assert.equal(parseId3Title(enc('not id3 at all')), null)
})

test('Icecast status pages: matching mount, single mount, artist/title split', () => {
  const json = {
    icestats: {
      source: [
        { listenurl: 'http://radio.test:8000/low', title: 'Wrong - Mount' },
        { listenurl: 'http://radio.test:8000/high.mp3', artist: 'Khruangbin', title: 'Maria También' },
      ],
    },
  }
  assert.equal(parseIcecastStatus(json, 'https://radio.test/high.mp3'), 'Khruangbin - Maria También')
  assert.equal(parseIcecastStatus({ icestats: { source: { listenurl: 'x', title: 'Solo - Mount' } } }, 'https://r.test/a'), 'Solo - Mount')
  assert.equal(parseIcecastStatus({ icestats: {} }, 'https://r.test/a'), null)
  assert.equal(parseIcecastStatus(null, 'https://r.test/a'), null)
})

test('worker: only public http(s) stream addresses are read', () => {
  assert.ok(streamUrl('https://stream.example.com:8000/live.mp3'))
  for (const bad of ['ftp://x.test/a', 'http://localhost/a', 'http://127.0.0.1/a', 'http://10.0.0.5/a', 'http://192.168.1.2/a', 'http://[::1]/a', 'https://u:p@x.test/a', 'nope', null]) {
    assert.equal(streamUrl(bad), null, String(bad))
  }
})

test('worker: reads ICY title from a streamed body and stops early', async () => {
  const meta = enc("StreamTitle='Röyksopp - Eple';")
  const block = new Uint8Array(Math.ceil(meta.length / 16) * 16)
  block.set(meta)
  let pulled = 0
  let cancelled = false
  const body = new ReadableStream({
    pull(c) {
      pulled++
      // 10 bytes of audio per chunk, then the metadata block, then endless audio
      if (pulled <= 5) c.enqueue(new Uint8Array(10))
      else if (pulled === 6) c.enqueue(new Uint8Array([block.length / 16, ...block]))
      else c.enqueue(new Uint8Array(10))
    },
    cancel() { cancelled = true },
  })
  const fakeFetch = async (_url, init) => {
    assert.equal(init.headers['Icy-MetaData'], '1')
    return new Response(body, { headers: { 'icy-metaint': '50' } })
  }
  assert.equal(await readIcyTitle(new URL('https://s.test/a'), fakeFetch), 'Röyksopp - Eple')
  assert.ok(cancelled, 'hangs up after the title')

  const noIcy = async () => new Response('audio', { headers: {} })
  assert.equal(await readIcyTitle(new URL('https://s.test/b'), noIcy), null)
  // Cached per stream: the second call doesn't fetch again
  let calls = 0
  const counting = async () => { calls++; return new Response(new Uint8Array([0, 0, 0, 0, 0]), { headers: { 'icy-metaint': '4' } }) }
  await workerNowPlaying(new URL('https://s.test/c'), 1000, counting)
  await workerNowPlaying(new URL('https://s.test/c'), 2000, counting)
  assert.equal(calls, 1)
})

const state = () => useRadioStore.getState()
beforeEach(() => useRadioStore.setState(useRadioStore.getInitialState(), true))

function json(data, ok = true) {
  return { ok, status: ok ? 200 : 404, json: async () => data }
}

test('service: Radio Paradise API for curated stations', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const urls = []
  const svc = new NowPlaying({ engine: {}, presenceUrl: '', fetchImpl: async (url) => (urls.push(url), json({ artist: 'Bonobo', title: 'Kerala' })) })
  const disconnect = svc.connect()
  t.after(disconnect)
  state().setPowered(true)
  state().setStation(station('rp-mellow', { source: 'curated', name: 'Radio Paradise · Mellow' }), 0, true)
  state().setTune('playing', 'LIVE')
  await flush()
  assert.match(urls[0], /now_playing\?chan=1$/)
  assert.deepEqual(state().nowPlaying, { stationId: 'rp-mellow', title: 'Bonobo - Kerala' })
})

test('service: status page first, then the presence server, and titles clear on station change', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(url)
    if (url.endsWith('/status-json.xsl')) return json(null, false)
    return json({ title: 'Air - Playground Love' })
  }
  const svc = new NowPlaying({ engine: {}, presenceUrl: 'https://presence.test', fetchImpl })
  t.after(svc.connect())
  state().setPowered(true)
  state().setStation(station('jazz', { url: 'https://radio.test:8000/jazz.mp3' }), 0, true)
  state().setTune('playing', 'LIVE')
  await flush()
  assert.deepEqual(urls, [
    'https://radio.test:8000/status-json.xsl',
    `https://presence.test/api/nowplaying?url=${encodeURIComponent('https://radio.test:8000/jazz.mp3')}`,
  ])
  assert.equal(state().nowPlaying.title, 'Air - Playground Love')

  // Next poll skips the status page that already failed
  urls.length = 0
  t.mock.timers.tick(20_000)
  await flush()
  assert.deepEqual(urls.map((u) => new URL(u).pathname), ['/api/nowplaying'])

  state().setStation(station('other'), 1, true)
  await flush()
  assert.notEqual(state().nowPlaying?.stationId, 'jazz', "the old station's song is cleared")
})

test('service: titles pushed from the stream (HLS) only count for the current station', (t) => {
  const engine = {}
  const svc = new NowPlaying({ engine, presenceUrl: '', fetchImpl: async () => json(null, false) })
  t.after(svc.connect())
  const hls = station('hls', { hls: true, url: 'https://h.test/live.m3u8' })
  state().setStation(hls, 0, true)
  engine.onStreamTitle(station('elsewhere'), 'Nope - Wrong')
  assert.equal(state().nowPlaying, null)
  engine.onStreamTitle(hls, 'Floating Points - Silhouettes')
  assert.deepEqual(state().nowPlaying, { stationId: 'hls', title: 'Floating Points - Silhouettes' })
})


test('enabling during an ad immediately refreshes metadata and buffering preserves replacement', async (t) => {
  let title = 'Artist - Song'
  let lookups = 0
  const svc = new NowPlaying({ engine: {}, presenceUrl: '' })
  svc.lookup = async () => { lookups++; return title }
  const disconnect = svc.connect()
  t.after(() => {
    disconnect()
    useAdReplacement.getState().setEnabled(false)
  })
  state().setPowered(true)
  state().setStation(station('ad-test'), 0, true)
  state().setTune('playing', 'LIVE')
  await flush()
  title = 'Commercial break'
  const before = lookups
  useAdReplacement.getState().setEnabled(true)
  await flush()
  assert.ok(lookups > before, 'toggle refreshes without waiting for next poll')
  assert.equal(useAdReplacement.getState().replacing, true)
  state().setTune('tuning', 'BUFFERING')
  assert.equal(useAdReplacement.getState().replacing, true)
  state().setTune('playing', 'LIVE')
  assert.equal(useAdReplacement.getState().replacing, true)
  useAdReplacement.getState().setEnabled(false)
  assert.equal(useAdReplacement.getState().replacing, false)
  useAdReplacement.getState().setEnabled(true)
  assert.equal(useAdReplacement.getState().replacing, true, 'remembered ad switches immediately')
  adReplacement.title('Artist - Next song')
  assert.equal(useAdReplacement.getState().replacing, false)
  state().setPowered(false)
})
