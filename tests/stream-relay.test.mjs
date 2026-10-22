import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
// The catalogue shares this module instance; priming it switches the relay on for this file
import { relayAvailable } from '../src/services/streamRelay.ts'
import { isStationId, relayEnabled, relayStream, stationAddress } from '../worker/src/relay.ts'
import { station } from './helpers.mjs'

let sequence = 0
const freshRelay = () => import(`../src/services/streamRelay.ts?test=${sequence++}`)
const freshApi = () => import(`../src/services/radioBrowser.ts?test=${sequence++}`)
const ID = '0f2e8c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b'
const response = (data) => ({ ok: true, json: async () => data })
const rb = (id, patch = {}) => ({
  stationuuid: id, name: id, url_resolved: `https://example.test/${id}`, lastcheckok: 1,
  countrycode: 'JP', country: 'Japan', state: '', geo_lat: 35, geo_long: 139, ...patch,
})
beforeEach(() => { globalThis.location = { protocol: 'https:' } })

test('client: the relay counts as on only when the server answers 204', async () => {
  const { relayAvailable: noServer } = await freshRelay()
  assert.equal(await noServer(''), false)
  for (const [answer, expected] of [[{ status: 204 }, true], [{ status: 404 }, false], [Promise.reject(new Error('down')), false]]) {
    const { relayAvailable: check } = await freshRelay()
    let calls = 0
    const fetchImpl = async (url) => {
      calls++
      assert.equal(url, 'https://hub.test/api/relay')
      return answer
    }
    assert.equal(await check('https://hub.test', fetchImpl), expected)
    assert.equal(await check('https://hub.test', fetchImpl), expected)
    assert.equal(calls, 1, 'asked once per page load')
  }
})

test('client: relayed stations play from the relay, everything else from the stream', async () => {
  const { playbackUrl } = await freshRelay()
  assert.equal(playbackUrl(station('a', { url: 'http://x.test/a', relay: true }), 'https://hub.test'), 'https://hub.test/api/relay/a')
  assert.equal(playbackUrl(station('a', { url: 'http://x.test/a', relay: true }), ''), 'http://x.test/a')
  assert.equal(playbackUrl(station('b'), 'https://hub.test'), 'https://example.test/b')
})

test('catalogue: with the relay on, plain-http streams are kept and marked; HLS over http is not', async (t) => {
  assert.equal(await relayAvailable('https://hub.test', async () => ({ status: 204 })), true)
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes('/json/servers')) return response([{ name: 'de1.api.radio-browser.info' }])
    return response([
      rb('secure'), rb('plain', { url_resolved: 'http://example.test/plain' }),
      rb('plain-hls', { url_resolved: 'http://example.test/live.m3u8', hls: 1 }),
    ])
  })
  const api = await freshApi()
  const results = await api.searchStations('test')
  assert.deepEqual(results.map((s) => [s.id, s.relay ?? false]), [['secure', false], ['plain', true]])

  globalThis.location = { protocol: 'http:' }
  assert.equal((await api.searchStations('test')).find((s) => s.id === 'plain').relay, undefined, 'http pages play http directly')
})

test('worker: the switch and station ids', () => {
  for (const on of ['on', ' ON ']) assert.equal(relayEnabled(on), true)
  for (const off of ['off', '', 'true', undefined]) assert.equal(relayEnabled(off), false)
  assert.equal(isStationId(ID), true)
  for (const bad of ['', 'abc', `${ID}/x`, '../json/servers']) assert.equal(isStationId(bad), false)
})

test('worker: only public, plain-http single streams are relayed, and lookups are cached', async () => {
  const cases = {
    'http://stream.example.com:8000/live.mp3': true,
    'https://stream.example.com/live.mp3': false,
    'http://10.0.0.5/live.mp3': false,
    'http://stream.example.com/list.pls': false,
    'http://stream.example.com/live.m3u8': false,
  }
  let i = 0
  for (const [address, relayed] of Object.entries(cases)) {
    const id = `${ID.slice(0, -2)}${String(i++).padStart(2, '0')}`
    let lookups = 0
    const fetchImpl = async (url) => {
      lookups++
      assert.ok(url.includes(`uuids=${id}`))
      return response([{ stationuuid: id, url_resolved: address, hls: 0 }])
    }
    const url = await stationAddress(id, 1000, fetchImpl)
    assert.equal(url?.toString() ?? null, relayed ? address : null, address)
    await stationAddress(id, 2000, fetchImpl)
    assert.equal(lookups, 1, 'cached')
  }
  const hlsId = `${ID.slice(0, -2)}99`
  assert.equal(await stationAddress(hlsId, 0, async () => response([{ stationuuid: hlsId, url_resolved: 'http://x.example.com/live', hls: 1 }])), null)
})

test('worker: audio passes straight through; anything else is refused', async () => {
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close() } })
  let sent
  const ok = await relayStream(new URL('http://x.example.com/live'), new AbortController().signal, async (url, init) => {
    sent = { url, init }
    return new Response(body, { headers: { 'content-type': 'audio/mpeg', 'icy-name': 'X' } })
  })
  assert.equal(sent.url, 'http://x.example.com/live')
  assert.equal(sent.init.headers['Icy-MetaData'], '0')
  assert.equal(ok.status, 200)
  assert.equal(ok.headers.get('content-type'), 'audio/mpeg')
  assert.equal(ok.headers.get('icy-name'), null)
  assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [1, 2, 3])

  let cancelled = false
  const page = new ReadableStream({ cancel() { cancelled = true } })
  const refused = await relayStream(new URL('http://x.example.com/'), new AbortController().signal, async () =>
    new Response(page, { headers: { 'content-type': 'text/html' } }))
  assert.equal(refused.status, 502)
  assert.equal(cancelled, true)
})
