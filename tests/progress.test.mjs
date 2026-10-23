import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { creditListening, dayKey, EMPTY_PROGRESS, hm, MAX_STAMPED_STATIONS, recordFocus, sanitizeProgress, STAMP_AFTER_MS, streak, totals, week } from '../src/progress/progress.ts'
import { EARNABLE, earnedParts, isEarned, newlyEarned } from '../src/progress/unlocks.ts'
import { logFocus, PassportTracker } from '../src/progress/track.ts'
import { cycle, PARTS, randomAvatar } from '../src/avatar/parts.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { station } from './helpers.mjs'

beforeEach(() => useRadioStore.setState(useRadioStore.getInitialState(), true))

const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h)

test('streaks count days in a row, ending today or yesterday, across month ends', () => {
  let p = EMPTY_PROGRESS
  for (const d of [day(2026, 2, 27), day(2026, 2, 28), day(2026, 3, 1), day(2026, 3, 2)]) p = recordFocus(p, 25, false, d)
  assert.equal(streak(p, day(2026, 3, 2, 23)), 4)
  assert.equal(streak(p, day(2026, 3, 3, 9)), 4, 'today not done yet: yesterday still counts')
  assert.equal(streak(p, day(2026, 3, 4)), 0, 'a missed day breaks it')
  assert.equal(streak(recordFocus(p, 25, false, day(2026, 3, 4)), day(2026, 3, 4)), 1)
})

test('focus logs add up by day and week, with friends counted apart; old days roll off', () => {
  let p = recordFocus(EMPTY_PROGRESS, 25, true, day(2026, 5, 10))
  p = recordFocus(p, 50, false, day(2026, 5, 10))
  p = recordFocus(p, 25, false, day(2026, 5, 1))
  assert.deepEqual(p.days[dayKey(day(2026, 5, 10))], { minutes: 75, together: 25 })
  assert.deepEqual(week(p, day(2026, 5, 10)), { minutes: 75, together: 25 }, 'May 1 is outside the week')
  const later = recordFocus(p, 5, false, day(2027, 7, 1))
  assert.equal(later.days[dayKey(day(2026, 5, 1))], undefined)
  assert.equal(hm(75), '1h 15m')
  assert.equal(hm(60), '1h')
  assert.equal(hm(35), '35m')
})

test('a station is stamped after two minutes, and its country with it', () => {
  const st = station('kexp', { country: 'US', location: 'Seattle', lat: 47.6, lon: -122.3 })
  let r = creditListening(EMPTY_PROGRESS, st, 60_000, 60_000, 1)
  assert.equal(r.progress, EMPTY_PROGRESS, 'not yet')
  r = creditListening(r.progress, st, 60_000, STAMP_AFTER_MS, 2)
  assert.equal(r.stamped, 'country')
  assert.equal(r.progress.stations.kexp.minutes, 2)
  assert.equal(r.progress.countries.US.minutes, 2)
  r = creditListening(r.progress, st, 30_000, STAMP_AFTER_MS + 30_000, 3)
  assert.equal(r.stamped, null)
  assert.equal(r.progress.stations.kexp.minutes, 2.5)
  r = creditListening(r.progress, station('kuow', { country: 'US' }), 0, STAMP_AFTER_MS, 4)
  assert.equal(r.stamped, 'station', 'a new station in a known country')
})

test('a full passport keeps the most-listened stations', () => {
  let p = EMPTY_PROGRESS
  for (let i = 0; i < MAX_STAMPED_STATIONS; i++) p = creditListening(p, station(`s${i}`), 0, STAMP_AFTER_MS + i * 1000, i).progress
  p = creditListening(p, station('new'), 0, STAMP_AFTER_MS, 999).progress
  assert.equal(Object.keys(p.stations).length, MAX_STAMPED_STATIONS)
  assert.ok(p.stations.new)
  assert.equal(p.stations.s0, undefined, 'the least-listened went')
})

test('saved progress is cleaned', () => {
  const p = sanitizeProgress({ days: { '2026-05-10': { minutes: 25, together: 'x' }, bad: {} }, countries: { US: { firstAt: 1, minutes: 2 }, usa: {} }, stations: { a: { name: 'A', lat: 999 } }, celebrated: ['hat:8', 3] })
  assert.deepEqual(p.days, { '2026-05-10': { minutes: 25, together: 0 } })
  assert.deepEqual(Object.keys(p.countries), ['US'])
  assert.equal(p.stations.a.lat, null)
  assert.deepEqual(p.celebrated, ['hat:8'])
  assert.deepEqual(sanitizeProgress('nope'), EMPTY_PROGRESS)
})

test('earned parts unlock at their milestone; locked ones are skipped and never random', () => {
  const beret = EARNABLE.find((p) => p.name === 'Beret')
  const none = totals(EMPTY_PROGRESS)
  assert.equal(isEarned(beret.unlock, none), false)
  assert.equal(isEarned(beret.unlock, { ...none, countries: 5 }), true)
  assert.deepEqual(newlyEarned({ ...none, countries: 5 }, []).map((p) => p.name), ['Beret'])
  assert.deepEqual(newlyEarned({ ...none, countries: 5 }, [beret.key]), [])

  const allowed = earnedParts(none)
  const flowerIndex = PARTS.hat.findIndex((p) => p.name === 'Flower')
  const next = cycle({ head: 0, hat: flowerIndex, shirt: 0, pants: 0, shoes: 0 }, 'hat', 1, allowed)
  assert.equal(next.hat, 0, 'locked hats after Flower are skipped, wrapping to No hat')
  for (let i = 0; i < 200; i++) {
    const a = randomAvatar()
    for (const slot of ['hat', 'shirt', 'pants', 'shoes']) assert.equal(PARTS[slot][a[slot]].unlock, undefined)
  }
})

test('a finished focus logs minutes, with friends when a friend focuses too, and celebrates unlocks', () => {
  const s = () => useRadioStore.getState()
  logFocus(25)
  assert.equal(totals(s().progress).focusHours, 25 / 60)
  s().setFriends({ list: [{ userId: 'b', name: 'Bob', code: '7K3Q9XZA', online: true, pid: null, presence: { station: null, avatar: null, focus: { phase: 'focus', remainingMs: 1, paused: false } } }] })
  logFocus(600)
  assert.equal(totals(s().progress).togetherHours, 10)
  assert.ok(s().progress.celebrated.includes(EARNABLE.find((p) => p.name === 'Halo').key))
  assert.match(s().toast.text, /^Unlocked for your avatar: /)
})

test('the passport tracker credits continuous listening only', () => {
  const s = () => useRadioStore.getState()
  const tracker = new PassportTracker()
  s().setPowered(true)
  s().setStation(station('jazz', { country: 'FR' }), 0, true)
  s().setTune('playing', 'LIVE')
  tracker.tick(0)
  tracker.tick(60_000)
  assert.equal(Object.keys(s().progress.stations).length, 0)
  tracker.tick(120_000)
  assert.ok(s().progress.stations.jazz)
  assert.match(s().toast.text, /New passport stamp/)
  tracker.tick(10 * 60 * 60_000)
  assert.ok(s().progress.stations.jazz.minutes < 4, 'a long sleep is not counted as listening')
  s().setStation(station('rock', { country: 'GB' }), 0, true)
  tracker.tick(10 * 60 * 60_000 + 60_000)
  assert.equal(s().progress.stations.rock, undefined, 'a new station starts from zero')
})
