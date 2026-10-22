import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worldTargets } from '../src/social/worldTargets.ts'

const avatar = { head: 0, hat: 0, shirt: 0, pants: 0, shoes: 0 }
const st = (id, lat = 48.8, lon = 2.3) => ({ id, name: `Station ${id}`, song: null, location: 'Paris', country: 'FR', lat, lon, curated: false })
const walker = (pid, stationId, name = null) => ({ pid, name, avatar, station: { ...st(stationId), song: null }, focus: null })
const friend = (userId, pid, station, online = true) => ({ userId, name: userId, code: '7K3Q9XZA', online, pid, presence: { station, focus: null, avatar } })

test('friends are drawn once, as friends; you and hidden or offline people are not strangers', () => {
  const walkers = {
    'pid-me-1234': walker('pid-me-1234', 'jazz'),
    'pid-bob-123': walker('pid-bob-123', 'jazz'),
    'pid-anon-12': walker('pid-anon-12', 'rock'),
    'pid-name-12': walker('pid-name-12', 'rock', 'Night Owl'),
  }
  const friends = [friend('bob', 'pid-bob-123', st('jazz')), friend('ada', null, null), friend('cy', 'pid-cy-1234', st('pop'), false)]
  const out = worldTargets(friends, walkers, 'pid-me-1234', 'everyone')
  assert.deepEqual(out.map((m) => [m.id, m.tier]), [['pid-anon-12', 'public'], ['pid-name-12', 'public'], ['bob', 'friend']])
  assert.equal(out[0].name, 'LISTENER')
  assert.equal(out[1].name, 'Night Owl')
  assert.equal(out[2].stationId, 'jazz')
})

test('friends only hides strangers but keeps friends', () => {
  const out = worldTargets([friend('bob', 'pid-bob-123', st('jazz'))], { 'pid-anon-12': walker('pid-anon-12', 'rock') }, null, 'friends')
  assert.deepEqual(out.map((m) => m.tier), ['friend'])
})

test('a friend without a placed station has no walker', () => {
  assert.deepEqual(worldTargets([friend('bob', 'pid-bob-123', st('jazz', null, null))], {}, null, 'everyone'), [])
})
