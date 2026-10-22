import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hub, HubError } from '../worker/src/core.ts'
import { formatCode } from '../src/social/protocol.ts'

class MemoryRepo {
  users = new Map()
  friends = new Map()
  createUser(u) { this.users.set(u.id, { ...u }) }
  userById(id) { return this.users.get(id) ?? null }
  userByCode(code) { return [...this.users.values()].find((u) => u.code === code) ?? null }
  userByTokenHash(hash) { return [...this.users.values()].find((u) => u.tokenHash === hash) ?? null }
  rename(id, name) { this.users.get(id).name = name }
  friendsOf(id) { return [...(this.friends.get(id) ?? [])] }
  addFriendship(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) this.friends.set(x, new Set([...(this.friends.get(x) ?? []), y]))
  }
  removeFriendship(a, b) {
    this.friends.get(a)?.delete(b)
    this.friends.get(b)?.delete(a)
  }
}

class FakeSocket {
  sent = []
  closed = null
  send(data) { this.sent.push(JSON.parse(data)) }
  close(code) { this.closed = code }
  last(type) { return this.sent.filter((m) => m.type === type).at(-1) }
  clear() { this.sent = [] }
}

function setup() {
  const repo = new MemoryRepo()
  const map = new Map()
  const sessions = { get: (ws) => map.get(ws) ?? null, set: (ws, s) => map.set(ws, s), all: () => [...map.keys()] }
  const hub = new Hub(repo, sessions)
  let now = 1_000_000
  const clock = { tick: (ms) => (now += ms), get now() { return now } }
  const send = (ws, msg) => hub.message(ws, JSON.stringify(msg), now)
  const connect = async (profile, invisible = false) => {
    const ws = new FakeSocket()
    await send(ws, { type: 'hello', token: profile.token, invisible })
    return ws
  }
  const close = (ws) => {
    hub.close(ws, now)
    map.delete(ws)
  }
  return { hub, repo, clock, send, connect, close }
}

const presence = (id, focus = null) => ({
  type: 'presence',
  presence: { station: { id, name: `Station ${id}`, location: 'Tokyo, Japan', country: 'jp', lat: 35.6, lon: 139.7, curated: false }, focus },
})

test('register validates names, hashes tokens and rate-limits per network', async () => {
  const { hub, repo, clock } = setup()
  await assert.rejects(hub.register('   ', '1.1.1.1', clock.now), HubError)
  const me = await hub.register('  Ada\u0000 Lovelace  ', '1.1.1.1', clock.now)
  assert.equal(me.name, 'Ada Lovelace')
  assert.match(formatCode(me.code), /^PR-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  assert.ok(me.token.length >= 40)
  assert.notEqual(repo.userById(me.userId).tokenHash, me.token)
  for (let i = 0; i < 9; i++) await hub.register(`u${i}`, '1.1.1.1', clock.now)
  await assert.rejects(hub.register('one too many', '1.1.1.1', clock.now), (e) => e.status === 429)
  await hub.register('other network', '2.2.2.2', clock.now)
})

test('unknown tokens and unauthenticated messages are refused', async () => {
  const { send } = setup()
  const ws = new FakeSocket()
  await send(ws, { type: 'hello', token: 'x'.repeat(43), invisible: false })
  assert.equal(ws.last('error').reason, 'auth')
  assert.equal(ws.closed, 4001)
  const anon = new FakeSocket()
  await send(anon, presence('a'))
  assert.equal(anon.closed, 4001)
})

test('adding by code is mutual and presence fans out only to friends', async () => {
  const { hub, clock, send, connect } = setup()
  const ada = await hub.register('Ada', 'ip', clock.now)
  const bob = await hub.register('Bob', 'ip', clock.now)
  const eve = await hub.register('Eve', 'ip', clock.now)
  const [wa, wb, we] = [await connect(ada), await connect(bob), await connect(eve)]
  assert.deepEqual(wa.last('welcome').friends, [])
  assert.equal(wa.last('welcome').v, 2)

  await send(wa, { type: 'addFriend', code: `pr-${bob.code.slice(0, 4).toLowerCase()} ${bob.code.slice(4)}` })
  assert.equal(wa.last('friend').friend.name, 'Bob')
  assert.equal(wa.last('friend').friend.online, true)
  assert.equal(wb.last('friend').friend.name, 'Ada')

  we.clear()
  wb.clear()
  await send(wa, presence('st1', { phase: 'focus', remainingMs: 10 * 60_000, paused: false }))
  const seen = wb.last('friend').friend
  assert.equal(seen.presence.station.id, 'st1')
  assert.equal(seen.presence.station.country, 'JP')
  assert.equal(seen.presence.focus.remainingMs, 10 * 60_000)
  assert.equal(we.sent.length, 0, 'strangers hear nothing')

  // A friend connecting later gets the focus time that is actually left
  clock.tick(4 * 60_000)
  const wb2 = await connect(bob)
  assert.equal(wb2.last('welcome').friends[0].presence.focus.remainingMs, 6 * 60_000)
})

test('add errors: unknown code, own code, malformed frames, rate limit', async () => {
  const { hub, clock, send, connect, repo } = setup()
  const ada = await hub.register('Ada', 'ip', clock.now)
  const ws = await connect(ada)
  const other = [...'0123456789ABCDEFGHJKMNPQRSTVWXYZ'].find((c) => !ada.code.startsWith(c))
  await send(ws, { type: 'addFriend', code: `${other}0000000` })
  assert.equal(ws.last('error').reason, 'not-found')
  await send(ws, { type: 'addFriend', code: ada.code })
  assert.equal(ws.last('error').reason, 'self')
  await hub.message(ws, '{nope', clock.now)
  assert.equal(ws.last('error').reason, 'invalid')
  await hub.message(ws, JSON.stringify({ type: 'rename', name: 'x'.repeat(3000) }), clock.now)
  assert.equal(ws.last('error').reason, 'invalid')
  for (let i = 0; i < 20; i++) await send(ws, { type: 'addFriend', code: ada.code })
  assert.equal(ws.last('error').reason, 'rate')
  assert.equal(repo.friendsOf(ada.userId).length, 0)
})

test('going offline, invisibility, multiple tabs and removal', async () => {
  const { hub, clock, send, connect, close } = setup()
  const ada = await hub.register('Ada', 'ip', clock.now)
  const bob = await hub.register('Bob', 'ip', clock.now)
  const wa = await connect(ada)
  const wb = await connect(bob)
  await send(wa, { type: 'addFriend', code: bob.code })

  // Second tab: closing one keeps Ada online
  const wa2 = await connect(ada)
  wb.clear()
  close(wa2)
  assert.equal(wb.sent.length, 0)
  close(wa)
  assert.equal(wb.last('friend').friend.online, false)
  assert.equal(wb.last('friend').friend.presence, null)

  // Invisible: Bob still sees friends, but Ada never sees him online
  const wa3 = await connect(ada)
  close(wb)
  const wbHidden = await connect(bob, true)
  assert.equal(wbHidden.last('welcome').friends[0].online, true)
  assert.equal(wa3.last('friend').friend.online, false)
  await send(wbHidden, presence('secret'))
  assert.equal(wa3.last('friend').friend.online, false)
  await send(wbHidden, { type: 'invisible', invisible: false })
  assert.equal(wa3.last('friend').friend.online, true)

  await send(wa3, { type: 'rename', name: 'Ada L' })
  assert.equal(wa3.last('self').self.name, 'Ada L')
  assert.equal(wbHidden.last('friend').friend.name, 'Ada L')

  await send(wa3, { type: 'removeFriend', userId: bob.userId })
  assert.equal(wa3.last('friendRemoved').userId, bob.userId)
  assert.equal(wbHidden.last('friendRemoved').userId, ada.userId)
})
