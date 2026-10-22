import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AVATAR_H, AVATAR_SLOTS, AVATAR_W, avatarFromId, composeAvatar, cycle, PART_COUNTS, PARTS, randomAvatar } from '../src/avatar/parts.ts'
import { AvatarWalker } from '../src/avatar/walker.ts'
import { sanitizeAvatar } from '../src/social/protocol.ts'

test('every part fits the 7×13 grid', () => {
  for (const slot of AVATAR_SLOTS) {
    for (const part of PARTS[slot]) {
      assert.ok(part.y + part.rows.length <= AVATAR_H, `${slot} ${part.name} too tall`)
      for (const row of part.rows) assert.equal(row.length, AVATAR_W, `${slot} ${part.name} row "${row}"`)
      for (const ch of part.rows.join('')) {
        if (ch !== '.' && ch !== 's') assert.ok(part.colors[ch], `${slot} ${part.name} has no colour for "${ch}"`)
      }
    }
  }
})

test('every combination composes, and parts land where expected', () => {
  for (let i = 0; i < 200; i++) {
    const grid = composeAvatar(randomAvatar())
    assert.equal(grid.length, AVATAR_H)
    assert.ok(grid.every((row) => row.length === AVATAR_W))
  }
  const a = { head: 0, hat: 0, shirt: 0, pants: 0, shoes: 0 }
  const grid = composeAvatar(a)
  assert.equal(grid[12][1], PARTS.shoes[0].colors.f)
  assert.equal(grid[4][2], '#20131c', 'eyes')
  assert.equal(grid[8][0], PARTS.head[0].skin, 'tee shows skin on the arms')
  // Mid-stride the feet spread outward
  const stride = composeAvatar(a, true)
  assert.equal(stride[12][0], grid[12][1])
  assert.equal(stride[12][6], grid[12][5])
})

test('cycling wraps both ways and ids give stable looks', () => {
  const a = { head: 0, hat: 0, shirt: 0, pants: 0, shoes: 0 }
  assert.equal(cycle(a, 'hat', -1).hat, PART_COUNTS.hat - 1)
  assert.equal(cycle({ ...a, hat: PART_COUNTS.hat - 1 }, 'hat', 1).hat, 0)
  assert.deepEqual(avatarFromId('user-1'), avatarFromId('user-1'))
  assert.ok(sanitizeAvatar(avatarFromId('user-2')))
})

test('avatars from the wire are validated', () => {
  assert.deepEqual(sanitizeAvatar({ head: 1, hat: 2, shirt: 3, pants: 4, shoes: 5 }), { head: 1, hat: 2, shirt: 3, pants: 4, shoes: 5 })
  assert.equal(sanitizeAvatar({ head: 1, hat: 2, shirt: 3, pants: 4 }), null)
  assert.deepEqual(sanitizeAvatar({ head: 99, hat: 2, shirt: 0, pants: 0, shoes: 0 }), { head: 0, hat: 2, shirt: 0, pants: 0, shoes: 0 }, 'a part from a newer client falls back per slot')
  assert.equal(sanitizeAvatar({ head: -1, hat: 0, shirt: 0, pants: 0, shoes: 0 }), null)
  assert.equal(sanitizeAvatar({ head: 1.5, hat: 0, shirt: 0, pants: 0, shoes: 0 }), null)
  assert.equal(sanitizeAvatar('nope'), null)
})

test('walkers appear in place, then walk to a new station and arrive', () => {
  const w = new AvatarWalker()
  const [first] = w.update([{ id: 'a', lon: 0, lat: 0 }], 0)
  assert.deepEqual([first.lon, first.lat, first.walking], [0, 0, false])
  const [start] = w.update([{ id: 'a', lon: -60, lat: 0 }], 10)
  assert.equal(start.walking, true)
  assert.equal(start.facing, -1)
  const [mid] = w.update([{ id: 'a', lon: -60, lat: 0 }], 11)
  assert.ok(mid.lon < 0 && mid.lon > -60)
  const [end] = w.update([{ id: 'a', lon: -60, lat: 0 }], 30)
  assert.deepEqual([end.lon, end.walking], [-60, false])
  // Gone from the list -> forgotten, so a return appears in place again
  w.update([], 31)
  const [back] = w.update([{ id: 'a', lon: 50, lat: 10 }], 32)
  assert.deepEqual([back.lon, back.walking], [50, false])
})
