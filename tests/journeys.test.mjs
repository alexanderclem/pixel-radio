import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { findStop, JOURNEYS } from '../src/session/journeys.ts'
import { nearbyAlternative } from '../src/session/recovery.ts'
import { stationIndex } from '../src/services/stationIndex.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { station } from './helpers.mjs'

beforeEach(() => {
  globalThis.location = { protocol: 'https:' }
  useRadioStore.setState(useRadioStore.getInitialState(), true)
})

const rb = (id, name, patch = {}) => ({
  stationuuid: id, name, url_resolved: `https://s/${id}`, codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1,
  countrycode: 'FR', country: 'France', state: 'Paris', homepage: '', tags: 'jazz', clickcount: 1, geo_lat: 48.85, geo_long: 2.35, ...patch,
})

test('journey stops match names honestly and prefer placed stations', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes('/json/servers')
        ? []
        : [rb('other', 'Radio Nova'), rb('unplaced', 'TSF JAZZ', { geo_lat: null, geo_long: null }), rb('tsf', 'TSF Jazz')],
  }))
  const stop = JOURNEYS[0].stops[0]
  assert.equal((await findStop(stop)).id, 'tsf')
})

test('a stop the directory does not know is null, and so is an outage', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [rb('nova', 'Radio Nova')] }))
  assert.equal(await findStop(JOURNEYS[0].stops[0]), null)
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  assert.equal(await findStop(JOURNEYS[0].stops[0]), null)
})

test('journeys have descriptions and a note for every stop', () => {
  for (const j of JOURNEYS) {
    assert.ok(j.description.length > 10)
    assert.ok(j.stops.length >= 5)
    for (const s of j.stops) assert.ok(s.note && s.city && /^[A-Z]{2}$/.test(s.country), s.name)
  }
})

test('"another nearby" looks around the station that was asked for, skipping what was tried', () => {
  const wanted = station('kexp', { lat: 47.6, lon: -122.3 })
  const kuow = station('kuow', { lat: 47.65, lon: -122.3 })
  const kplu = station('kplu', { lat: 47.2, lon: -122.4 })
  stationIndex.add([wanted, kuow, kplu])
  const fallback = station('rp-main', { source: 'curated' })
  assert.equal(nearbyAlternative(wanted, fallback).id, 'kuow')
  assert.equal(nearbyAlternative(wanted, fallback, ['kuow']).id, 'kplu')
  useRadioStore.getState().setStations([fallback, station('next')])
  assert.equal(nearbyAlternative(null, fallback).id, 'next', 'no position: the next candidate, never a curated one')
})
