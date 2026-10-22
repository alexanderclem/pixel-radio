import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { parseSessionQuery, sanitizeSetup, sessionQuery } from '../src/session/setup.ts'
import { parseDeepLink } from '../src/routing/deepLink.ts'
import { ATMOSPHERES, pickStation } from '../src/session/atmospheres.ts'
import { moodLine } from '../src/session/describe.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { station } from './helpers.mjs'

beforeEach(() => useRadioStore.setState(useRadioStore.getInitialState(), true))

const settings = {
  view: { lon: 139.69, lat: 35.68, zoom: 6 },
  weather: { mode: 'rain', density: 0.65, wind: 0.42 },
  sky: 'night',
  mix: { rain: 0.85, wind: 0.3, city: 0.55, fire: 0, pad: 0.45, staticBlend: 0.05, hiss: 0.1, cutoff: 0.85 },
  ambientLinked: false,
  atmosphereId: 'rainy-tokyo',
  timer: { work: 50, short: 10 },
}
const near = (a, b) => Math.abs(a - b) <= 0.006

test('a session survives a link round trip, to the nearest percent', () => {
  const q = sessionQuery(settings)
  assert.match(q, /^atm=rainy-tokyo&at=139\.69%2C35\.68%2C6\.0&wx=rain\.64\.42&sky=night&mix=84\.30\.54\.0\.45\.5\.10\.84&geo=0&t=50-10$/)
  const back = parseSessionQuery(q)
  assert.deepEqual(back.view, settings.view)
  assert.equal(back.weather.mode, 'rain')
  assert.ok(near(back.weather.density, 0.65))
  assert.equal(back.sky, 'night')
  for (const [k, v] of Object.entries(settings.mix)) assert.ok(near(back.mix[k], v), k)
  assert.equal(back.ambientLinked, false)
  assert.equal(back.atmosphereId, 'rainy-tokyo')
  assert.deepEqual(back.timer, { work: 50, short: 10 })
  assert.equal(/master|stream/.test(q), false, 'volume never travels')
})

test('bad session parameters are dropped one by one', () => {
  const back = parseSessionQuery('at=999,0,6&wx=hail.50.50&sky=noon&mix=1.2.3&geo=maybe&t=0-5&atm=Rainy!&extra=1')
  assert.equal(back, null, 'nothing usable')
  const partial = parseSessionQuery('wx=snow.99.0&sky=aurora&mix=1.2.3')
  assert.deepEqual(partial, { weather: { mode: 'snow', density: 1, wind: 0 }, sky: 'aurora' })
  assert.equal(parseSessionQuery(''), null)
  assert.deepEqual(parseSessionQuery('at=10,20,99').view, { lon: 10, lat: 20, zoom: 32 }, 'zoom clamped')
})

test('session links parse from the shared path', () => {
  const link = parseDeepLink('/s/rp-main', `?${sessionQuery(settings)}`)
  assert.equal(link.kind, 'station')
  assert.equal(link.session.atmosphereId, 'rainy-tokyo')
  assert.equal(parseDeepLink('/s/rp-main', '?utm_source=x').session, null, 'unrelated query: a plain station link')
})

test('saved setups are validated when read back', () => {
  const isStation = (s) => typeof s?.id === 'string' && typeof s?.url === 'string'
  const st = station('jazz')
  assert.equal(sanitizeSetup({ ...settings, station: st }, isStation).station.id, 'jazz')
  assert.equal(sanitizeSetup({ ...settings, station: { id: 1 } }, isStation), null)
  assert.equal(sanitizeSetup({ ...settings, weather: null, station: st }, isStation), null)
  assert.equal(sanitizeSetup('nope', isStation), null)
})

test('persisted setups and the last session merge safely', () => {
  const st = station('jazz')
  const { merge } = useRadioStore.persist.getOptions()
  const merged = merge(
    {
      library: { setups: [{ id: 'a', name: 'Evening', setup: { ...settings, station: st }, savedAt: 5 }, { id: 'b', name: 'Broken', setup: {} }] },
      lastSession: { ...settings, station: st, savedAt: 9 },
      atmosphere: { id: 'rainy-tokyo', name: 'Rainy Tokyo' },
    },
    useRadioStore.getInitialState(),
  )
  assert.deepEqual(merged.library.setups.map((x) => x.name), ['Evening'])
  assert.equal(merged.lastSession.station.id, 'jazz')
  assert.equal(merged.lastSession.savedAt, 9)
  assert.equal(merged.atmosphere.name, 'Rainy Tokyo')
  const empty = merge({ lastSession: { station: st } }, useRadioStore.getInitialState())
  assert.equal(empty.lastSession, null, 'a last session without its mood is ignored')
})

test('atmospheres fall back to a curated station when the directory is down', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  for (const atm of ATMOSPHERES) {
    const picked = await pickStation(atm)
    assert.equal(picked.source, 'curated', atm.id)
    assert.equal(picked.id, atm.fallbackId)
  }
})

test('atmospheres pick a placed, HTTPS station from the directory', async (t) => {
  globalThis.location = { protocol: 'https:' }
  t.after(() => delete globalThis.location)
  const rb = (id, patch) => ({ stationuuid: id, name: id, url_resolved: `https://s/${id}`, codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, countrycode: 'FR', country: 'France', state: '', homepage: '', tags: 'jazz', clickcount: 1, geo_lat: null, geo_long: null, ...patch })
  t.mock.method(globalThis, 'fetch', async (url) => ({
    ok: true,
    json: async () => (String(url).includes('/json/servers') ? [] : [rb('unplaced'), rb('placed', { geo_lat: 48.8, geo_long: 2.3 })]),
  }))
  const picked = await pickStation(ATMOSPHERES.find((a) => a.id === 'morning-jazz'))
  assert.equal(picked.id, 'placed')
})

test('the mood line says themed or live, never leaving it ambiguous', () => {
  assert.equal(moodLine(settings), 'Rainy Tokyo · themed rain · night · 50-min focus')
  assert.equal(moodLine({ weather: { mode: 'auto', density: 0.5, wind: 0.5 }, sky: 'auto' }), 'live weather')
})
