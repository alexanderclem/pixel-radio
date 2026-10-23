import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AVATAR_SLOTS } from '../src/avatar/parts.ts'
import { composeVehicle, vehicleFrames } from '../src/avatar/vehicles.ts'
import { AvatarWalker, planTrip } from '../src/avatar/walker.ts'

// Land west of lon 10 and east of lon 30; 20° of sea in between, plus a river at lon -20
const land = (lon) => (lon < 10 || lon > 30) && Math.abs(lon + 20) > 0.4
const modes = (legs) => legs.map((l) => l.mode)
const total = (legs) => legs.reduce((s, l) => s + l.duration, 0)

test('short trips over land walk, and narrow rivers are waded', () => {
  assert.deepEqual(modes(planTrip('a', { lon: -30, lat: 0 }, { lon: 0, lat: 0 }, land)), ['walk'])
})

test('a sea crossing walks to the coast, rows across and walks on', () => {
  const legs = planTrip('a', { lon: 0, lat: 0 }, { lon: 55, lat: 0 }, land)
  assert.deepEqual(modes(legs), ['walk', 'boat', 'walk'])
  const boat = legs[1]
  assert.ok(Math.abs(boat.fromLon - 10) < 1 && Math.abs(boat.toLon - 30) < 1, `boat leg ${boat.fromLon}→${boat.toLon}`)
  // Legs join up end to end
  assert.equal(legs[0].toLon, legs[1].fromLon)
  assert.equal(legs[1].toLon, legs[2].fromLon)
})

test('long trips and wide oceans fly', () => {
  for (const legs of [
    planTrip('a', { lon: -60, lat: 0 }, { lon: 60, lat: 0 }, land),
    planTrip('a', { lon: -60, lat: 0 }, { lon: 60, lat: 0 }, null),
  ]) {
    assert.equal(legs.length, 1)
    assert.ok(['plane', 'balloon'].includes(legs[0].mode))
  }
  // 30° of open water is too far to row even on a short trip
  const wide = (lon) => lon < 0 || lon > 30
  assert.notEqual(planTrip('a', { lon: -5, lat: 0 }, { lon: 35, lat: 0 }, wide)[0].mode, 'boat')
})

test('without terrain only distance decides', () => {
  assert.deepEqual(modes(planTrip('a', { lon: 0, lat: 0 }, { lon: -60, lat: 0 })), ['walk'])
})

test('the aircraft choice is stable per person and destination, and both kinds occur', () => {
  const pick = (id, lon) => planTrip(id, { lon: -50, lat: 0 }, { lon, lat: 10 })[0].mode
  assert.equal(pick('ada', 60), pick('ada', 60))
  const seen = new Set()
  for (let i = 0; i < 40; i++) seen.add(pick(`user-${i}`, 60))
  assert.deepEqual([...seen].sort(), ['balloon', 'plane'])
})

test('trip durations stay within bounds', () => {
  const longest = planTrip('a', { lon: -170, lat: -60 }, { lon: 170, lat: 70 })
  assert.ok(total(longest) <= 12.001)
  const tiny = planTrip('a', { lon: 0, lat: 0 }, { lon: 0.1, lat: 0 })
  assert.ok(total(tiny) >= 1.2 - 1e-9)
})

test('flights climb, cruise and land, and departures are reported once per leg', () => {
  const w = new AvatarWalker()
  const departures = []
  w.onDepart = (id, mode) => departures.push([id, mode])
  w.update([{ id: 'a', lon: -60, lat: 0 }], 0)
  const [start] = w.update([{ id: 'a', lon: 60, lat: 0 }], 10)
  assert.ok(start.walking && ['plane', 'balloon'].includes(start.mode))
  assert.equal(start.altitude, 0)
  const [mid] = w.update([{ id: 'a', lon: 60, lat: 0 }], 13)
  assert.ok(mid.altitude > 0.5, `altitude ${mid.altitude}`)
  w.update([{ id: 'a', lon: 60, lat: 0 }], 13.5)
  const [end] = w.update([{ id: 'a', lon: 60, lat: 0 }], 40)
  assert.deepEqual([end.lon, end.walking, end.mode, end.altitude], [60, false, 'idle', 0])
  assert.deepEqual(departures, [['a', start.mode]])
})

test('retargeting mid-flight keeps flying instead of dropping into the sea', () => {
  const w = new AvatarWalker()
  w.setLand(land)
  w.update([{ id: 'a', lon: -60, lat: 0 }], 0)
  w.update([{ id: 'a', lon: 60, lat: 0 }], 10)
  const [air] = w.update([{ id: 'a', lon: 60, lat: 0 }], 13)
  assert.ok(air.altitude > 0)
  // A new, nearby station: still airborne
  const [turn] = w.update([{ id: 'a', lon: air.lon + 5, lat: 0 }], 13)
  assert.ok(['plane', 'balloon'].includes(turn.mode))
})

test('boats ride the water and walkers have no altitude', () => {
  const w = new AvatarWalker()
  w.setLand(land)
  const departures = []
  w.onDepart = (id, mode) => departures.push(mode)
  w.update([{ id: 'a', lon: 0, lat: 0 }], 0)
  const seen = new Set()
  for (let t = 1; t < 15; t += 0.05) {
    const [p] = w.update([{ id: 'a', lon: 55, lat: 0 }], t)
    seen.add(p.mode)
    if (p.mode === 'boat') assert.ok(!land(p.lon), `boat on land at ${p.lon}`)
    if (p.mode === 'walk' || p.mode === 'boat') assert.equal(p.altitude, 0)
  }
  assert.deepEqual([...seen].sort(), ['boat', 'idle', 'walk'])
  assert.deepEqual(departures, ['boat'])
})

test('vehicle sprites are well formed and carry the rider', () => {
  const avatar = Object.fromEntries(AVATAR_SLOTS.map((s) => [s, 0]))
  for (const mode of ['boat', 'plane', 'balloon']) {
    for (let f = 0; f < vehicleFrames(mode); f++) {
      const grid = composeVehicle(avatar, mode, f)
      assert.ok(grid.length > 0)
      assert.ok(grid.every((row) => row.length === grid[0].length), `${mode} rows are even`)
      const colors = new Set(grid.flat().filter(Boolean))
      assert.ok(colors.has('#20131c'), `${mode} shows the rider's eyes`)
      assert.ok(colors.size > 4)
    }
  }
})
