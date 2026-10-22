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
