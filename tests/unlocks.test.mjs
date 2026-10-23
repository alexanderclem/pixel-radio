import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { PARTS } from '../src/avatar/parts.ts'
import { EMPTY_PROGRESS, mergeProgress, recordRide, sanitizeProgress, totals } from '../src/progress/progress.ts'
import { logRide } from '../src/progress/track.ts'
import { earnedParts, unlockLabel } from '../src/progress/unlocks.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'

const state = () => useRadioStore.getState()
beforeEach(() => {
  delete globalThis.localStorage
  useRadioStore.setState(useRadioStore.getInitialState(), true)
})

const index = (slot, name) => PARTS[slot].findIndex((p) => p.name === name)

test('rides earn the travel parts', () => {
  let p = EMPTY_PROGRESS
  const wearable = () => earnedParts(totals(p))
  assert.ok(!wearable()('hat', index('hat', 'Captain')))
  assert.ok(!wearable()('shirt', index('shirt', 'Sky tee')))
  for (let i = 0; i < 3; i++) p = recordRide(p, 'boat')
  p = recordRide(p, 'balloon')
  assert.ok(wearable()('hat', index('hat', 'Captain')))
  assert.ok(wearable()('shirt', index('shirt', 'Sky tee')))
  assert.ok(!wearable()('hat', index('hat', 'Aviator')))
  assert.equal(unlockLabel(PARTS.hat[index('hat', 'Aviator')].unlock), 'Fly 3 times')
})

test('logging a ride announces what it unlocked, once', () => {
  logRide('balloon')
  assert.equal(state().progress.rides.balloon, 1)
  assert.match(state().toast.text, /Sky tee/)
  const nonce = state().toast.nonce
  logRide('balloon')
  assert.equal(state().toast.nonce, nonce)
})

test('ride counts are sanitized and merged', () => {
  assert.deepEqual(sanitizeProgress({ rides: { boat: -2, plane: 2.7, balloon: 'x' } }).rides, { boat: 0, plane: 2, balloon: 0 })
  assert.deepEqual(sanitizeProgress({}).rides, { boat: 0, plane: 0, balloon: 0 })
  const a = { ...EMPTY_PROGRESS, rides: { boat: 4, plane: 0, balloon: 1 }, days: { '2026-10-01': { minutes: 25, together: 0 } }, celebrated: ['hat:1'] }
  const b = {
    ...EMPTY_PROGRESS,
    rides: { boat: 1, plane: 2, balloon: 0 },
    days: { '2026-10-01': { minutes: 50, together: 25 }, '2026-10-02': { minutes: 25, together: 0 } },
    countries: { JP: { firstAt: 5, minutes: 3 } },
    celebrated: ['hat:2'],
  }
  const m = mergeProgress(a, b)
  assert.deepEqual(m.rides, { boat: 4, plane: 2, balloon: 1 })
  assert.deepEqual(m.days, { '2026-10-01': { minutes: 50, together: 25 }, '2026-10-02': { minutes: 25, together: 0 } })
  assert.deepEqual(Object.keys(m.countries), ['JP'])
  assert.deepEqual(m.celebrated.sort(), ['hat:1', 'hat:2'])
})
