import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { cycle, PARTS, randomAvatar } from '../src/avatar/parts.ts'
import { EMPTY_PROGRESS, evaluateUnlocks, isPartUnlocked, rewardOf, sanitizeProgress, sanitizeUnlocks, UNLOCKS } from '../src/avatar/unlocks.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { station } from './helpers.mjs'

const state = () => useRadioStore.getState()
beforeEach(() => {
  delete globalThis.localStorage
  useRadioStore.setState(useRadioStore.getInitialState(), true)
})

test('every unlock earns exactly one part', () => {
  for (const u of UNLOCKS) {
    assert.ok(rewardOf(u.id), `${u.id} has a reward`)
    const owners = Object.values(PARTS).flat().filter((p) => p.unlock === u.id)
    assert.equal(owners.length, 1, u.id)
  }
})

test('thresholds unlock once', () => {
  assert.deepEqual(evaluateUnlocks(EMPTY_PROGRESS, []), [])
  const p = { ...EMPTY_PROGRESS, boatTrips: 3, flights: 2, countries: Array.from({ length: 10 }, (_, i) => `A${String.fromCharCode(65 + i)}`) }
  assert.deepEqual(evaluateUnlocks(p, []).sort(), ['globetrotter', 'sailor'])
  assert.deepEqual(evaluateUnlocks(p, ['sailor']), ['globetrotter'])
})

test('locked parts are skipped when cycling and never picked at random', () => {
  const captain = PARTS.hat.findIndex((p) => p.unlock === 'sailor')
  const allowed = (slot, i) => isPartUnlocked(slot, i, [])
  const before = { head: 0, hat: captain - 1, shirt: 0, pants: 0, shoes: 0 }
  // Every hat after the free ones is locked, so stepping forward wraps to the first
  assert.equal(cycle(before, 'hat', 1, allowed).hat, 0)
  assert.equal(cycle(before, 'hat', 1, (slot, i) => isPartUnlocked(slot, i, ['sailor'])).hat, captain)
  for (let i = 0; i < 300; i++) {
    const a = randomAvatar()
    for (const slot of Object.keys(a)) assert.ok(!PARTS[slot][a[slot]].unlock)
  }
})

test('rides, plays, focus sessions and friends count towards unlocks', () => {
  state().recordRide('boat')
  state().recordRide('boat')
  assert.equal(state().unlockNotice, null)
  state().recordRide('boat')
  assert.deepEqual(state().unlocks, ['sailor'])
  assert.equal(state().unlockNotice.id, 'sailor')

  state().recordRide('balloon')
  assert.equal(state().unlockNotice.id, 'aeronaut')

  state().pushRecent(station('a', { country: 'jp' }))
  state().pushRecent(station('a', { country: 'jp' }))
  state().pushRecent(station('b', { country: 'FR' }))
  assert.deepEqual(state().progress.countries, ['JP', 'FR'])
  assert.deepEqual(state().progress.stations, ['a', 'b'])

  for (let i = 0; i < 10; i++) state().recordFocusSession()
  assert.ok(state().unlocks.includes('scholar'))

  const friend = (id) => ({ userId: id, name: id, code: '7K3Q9XZA', username: null, online: false, presence: null })
  state().setFriends({ list: [friend('x'), friend('y'), friend('z')] })
  state().setFriends({ list: [] })
  assert.equal(state().progress.friends, 3)
  assert.ok(state().unlocks.includes('social'))
})

test('saved progress and unlocks are sanitized', () => {
  assert.deepEqual(sanitizeProgress('nope'), EMPTY_PROGRESS)
  const p = sanitizeProgress({ boatTrips: -4, flights: 2.7, countries: ['JP', 'jp', 'xx1', 5, 'JP'], stations: ['ok', '<script>'], friends: Infinity })
  assert.deepEqual(p, { ...EMPTY_PROGRESS, flights: 2, countries: ['JP'], stations: ['ok'] })
  assert.deepEqual(sanitizeUnlocks(['sailor', 'admin', 'sailor', 3]), ['sailor'])
})

test('progress and unlocks survive a reload', async () => {
  const data = new Map()
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
  state().recordRide('plane')
  state().recordRide('balloon')
  const saved = data.get('pixel-radio.v1')
  // Resetting the store saves the defaults, so put the earlier save back before reloading
  useRadioStore.setState(useRadioStore.getInitialState(), true)
  data.set('pixel-radio.v1', saved)
  await useRadioStore.persist.rehydrate()
  assert.equal(state().progress.flights, 1)
  assert.deepEqual(state().unlocks, ['aeronaut'])
})
