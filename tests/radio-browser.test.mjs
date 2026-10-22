import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { flush } from './helpers.mjs'

let sequence = 0
const freshApi = () => import(`../src/services/radioBrowser.ts?test=${sequence++}`)
const response = (data) => ({ ok: true, json: async () => data })
const rb = (id, patch = {}) => ({
  stationuuid: id, name: id, url_resolved: `https://example.test/${id}`, lastcheckok: 1,
  countrycode: 'JP', country: 'Japan', state: '', geo_lat: 35, geo_long: 139, ...patch,
})
beforeEach(() => { globalThis.location = { protocol: 'https:' } })

test('discovers current hosts, rejects injected server names and filters unsafe media URLs', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url)
    if (url.includes('/json/servers')) return response([
      { name: 'new.api.radio-browser.info' }, { name: 'evil.example' }, { name: 'https://evil.example' }, null,
    ])
    if (!url.startsWith('https://new.api.')) {
      await flush()
      throw new Error('unavailable')
    }
    return response([
      rb('good'), rb('http', { url_resolved: 'http://example.test/http' }),
      rb('script', { url_resolved: 'javascript:alert(1)' }), rb('playlist', { url_resolved: 'https://example.test/list.pls' }),
      null, rb('bad-coordinates', { geo_lat: 500 }),
    ])
  })
  const api = await freshApi()
  const results = await api.searchStations('test')
  assert.deepEqual(results.map((s) => s.id), ['good', 'bad-coordinates'])
  assert.equal(results[1].lat, null)
  assert.equal(calls.some((url) => url.includes('evil.example')), false)
  assert.equal(calls.some((url) => url.includes('fi1.') || url.includes('nl1.')), false)
})

test('caller cancellation stops lookup promptly and never starts another mirror', async (t) => {
  const ctrl = new AbortController()
  const calls = []
  t.mock.method(globalThis, 'fetch', (url, options) => {
    if (url.includes('/json/servers')) return Promise.resolve(response([{ name: 'de1.api.radio-browser.info' }]))
    calls.push(url)
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  })
  const api = await freshApi()
  const pending = api.searchStations('test', ctrl.signal)
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  ctrl.abort()
  await rejected
  assert.equal(calls.length, 1)
})

test('city lookup retains a successful nearby result when national search reaches the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), ms)
    return ctrl.signal
  })
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/json/servers')) return response([{ name: 'de1.api.radio-browser.info' }])
    if (url.includes('geo_lat')) return response([rb('nearby')])
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  })
  const api = await freshApi()
  const pending = api.findStationsForCity({ id: 'test', lat: 35, lon: 139, countryCode: 'JP' })
  await flush()
  t.mock.timers.tick(3000)
  await flush()
  t.mock.timers.tick(1500)
  await flush()
  assert.deepEqual((await pending).map((s) => s.id), ['nearby'])
})

test('aborted city lookups do not poison the city cache', async (t) => {
  let allow = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('/json/servers')) return response([{ name: 'de1.api.radio-browser.info' }])
    if (allow) return response([rb('fresh')])
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  })
  const api = await freshApi()
  const city = { id: 'test', lat: 35, lon: 139, countryCode: 'JP' }
  const ctrl = new AbortController()
  const rejected = assert.rejects(api.findStationsForCity(city, ctrl.signal), { name: 'AbortError' })
  ctrl.abort()
  await rejected
  allow = true
  assert.deepEqual((await api.findStationsForCity(city)).map((s) => s.id), ['fresh'])
})
