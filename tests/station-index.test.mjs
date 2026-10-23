import { test } from 'node:test'
import assert from 'node:assert/strict'
import { station } from './helpers.mjs'

let sequence = 0
const freshIndex = async () => (await import(`../src/services/stationIndex.ts?test=${sequence++}`)).stationIndex

test('stations without coordinates wait for their country, then land near its stations', async () => {
  const index = await freshIndex()
  assert.equal(index.add([station('unplaced', { country: 'KE', state: 'Nairobi' }), station('nowhere', { country: '' })]), 0)
  assert.equal(index.size, 0)

  const anchor = station('anchor', { country: 'KE', state: 'Nairobi', lat: -1.29, lon: 36.82 })
  assert.equal(index.add([anchor]), 2, 'the anchor and the station that was waiting for it')
  const placed = index.get('unplaced')
  assert.equal(placed.approx, true)
  assert.ok(Math.abs(placed.lat - anchor.lat) < 0.5 && Math.abs(placed.lon - anchor.lon) < 0.5)
  assert.equal(index.get('nowhere'), undefined, 'no country, nowhere to put it')

  assert.equal(index.add([station('unplaced', { country: 'KE' }), anchor]), 0, 'duplicates are ignored')
  assert.equal(index.size, 2)
})

const settled = () => new Promise((resolve) => setTimeout(resolve, 300))

test('once the coastline loads, stations in the water move onto land and stacks fan out over land', async () => {
  const index = await freshIndex()
  const { spreadOffset } = await import('../src/render/stack.ts')
  // Land west of the prime meridian, sea to the east; nothing known until the tiles "arrive"
  let loaded = false
  const land = { isLand: (lon) => (loaded ? lon < 0 : null), onLoad: null }
  const wet = station('wet', { lat: 10, lon: 0.05, country: 'ZZ' })
  const far = station('far', { lat: 10, lon: 3, country: 'ZZ' })
  const dry = station('dry', { lat: 10, lon: -1, country: 'ZZ' })
  const stack = Array.from({ length: 8 }, (_, i) => station(`stack-${i}`, { lat: 20, lon: -0.03, country: 'ZZ' }))
  index.add([wet, far, dry, ...stack])
  index.setLand(land)
  await settled()
  assert.equal(index.get('wet').lon, 0.05, 'stays put while its land is loading')

  loaded = true
  const version = index.version
  land.onLoad()
  await settled()
  assert.ok(index.version > version)
  const moved = index.get('wet')
  assert.ok(moved.lon < 0 && moved.lon > -0.02, `moved to the nearby coast, at ${moved.lon}`)
  assert.ok(Math.abs(moved.lat - 10) < 0.01)
  assert.equal(index.get('far').lon, 3, 'too far out to sea to move')
  assert.equal(index.get('dry').lon, -1)
  assert.deepEqual(index.within(-0.1, 9.9, 0, 10.1).map((s) => s.id), ['wet'], 're-bucketed at its new spot')

  const slots = stack.map((s) => index.rank(s.id))
  assert.equal(slots[0], 0)
  assert.equal(new Set(slots).size, slots.length, 'every station its own slot')
  for (const k of slots) {
    const [ox] = spreadOffset(k, 1)
    assert.ok(-0.03 + (ox * 1.25) / 200 < 0, `slot ${k} reaches into the sea`)
  }
  assert.ok(slots.some((k, i) => k !== i), 'slots over the sea were skipped')
})
