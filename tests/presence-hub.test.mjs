import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HOST_GRACE_MS, Hub, HubError, newSession, ROOM_TTL_MS, upgradeSession, WORLD_TICK_MS } from '../worker/src/core.ts'
import { LIMITS, publicName } from '../src/social/protocol.ts'
import { formatCode } from '../src/social/protocol.ts'
import { MemoryRepo } from './helpers.mjs'

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
  const ticks = []
  const hub = new Hub(repo, sessions, (at) => ticks.push(at))
  let now = 1_000_000
  const clock = { tick: (ms) => (now += ms), get now() { return now } }
  const send = (ws, msg) => hub.message(ws, JSON.stringify(msg), now)
  const connect = async (profile, invisible = false, extra = {}) => {
    const ws = new FakeSocket()
    map.set(ws, newSession(now, extra.ip ?? 'ip'))
    await send(ws, { type: 'hello', token: profile.token, invisible, ...extra })
    return ws
  }
  const guest = async (ip = 'ip', mode = 'anonymous') => {
    const ws = new FakeSocket()
    map.set(ws, newSession(now, ip))
    await send(ws, { type: 'guest', v: 2, public: mode })
    return ws
  }
  const close = (ws) => {
    hub.close(ws, now)
    map.delete(ws)
  }
  return { hub, repo, clock, send, connect, guest, close, ticks, sessions: map }
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

const V2 = { v: 2, public: 'anonymous' }
const at = (id, lat = 35.6, lon = 139.7) => ({
  type: 'presence',
  presence: { station: { id, name: `Station ${id}`, location: 'Tokyo, Japan', country: 'jp', lat, lon, curated: false }, focus: null, avatar: null },
})

test('guests and v2 clients see the world; v1 clients and hidden people stay out of it', async () => {
  const { hub, clock, send, connect, guest, ticks, sessions } = setup()
  const ada = await hub.register('Ada', 'ip', clock.now)
  const old = await hub.register('Old', 'ip', clock.now)
  const wa = await connect(ada, false, V2)
  const wold = await connect(old)
  assert.ok(wa.last('worldSnapshot'), 'v2 clients get a snapshot on hello')
  assert.equal(wold.last('worldSnapshot'), undefined, 'v1 clients never get world frames')

  const wg = await guest()
  assert.deepEqual(wg.last('worldSnapshot'), { type: 'worldSnapshot', pid: sessions.get(wg).pid, walkers: [], crowds: [], online: 0 })
  await send(wg, at('jazz'))
  await send(wa, at('jazz'))
  await send(wold, at('jazz'))
  assert.ok(ticks.length > 0, 'changes ask for a tick')

  hub.tick(clock.now)
  const delta = wa.last('worldDelta')
  assert.equal(delta.upsert.length, 2, 'Ada and the guest; the v1 client is not public')
  assert.equal(delta.online, 2)
  assert.deepEqual(delta.crowds.map((c) => [c.stationId, c.count]), [['jazz', 2]])
  assert.ok(delta.upsert.every((w) => w.pid !== ada.userId && w.name === null), 'anonymous: no name, no user id')
  assert.ok(delta.upsert.every((w) => w.avatar && w.station.lat === 35.6))
  assert.ok(wg.last('worldDelta'), 'guests get deltas too')
  assert.equal(wold.last('worldDelta'), undefined)

  // Guests may only publish presence and pick a mode
  await send(wg, { type: 'addFriend', code: ada.code })
  assert.equal(wg.closed, 4001)
})

test('deltas carry only what changed; a new socket starts from the last tick', async () => {
  const { hub, clock, send, connect, guest, close } = setup()
  const ada = await hub.register('Ada', 'ip', clock.now)
  const wa = await connect(ada, false, V2)
  const g1 = await guest()
  await send(g1, at('jazz'))
  await send(wa, at('rock'))
  hub.tick(clock.now)
  const g1pid = wa.last('worldDelta').upsert.find((w) => w.station.id === 'jazz').pid

  wa.clear()
  hub.tick(clock.tick(WORLD_TICK_MS))
  assert.equal(wa.last('worldDelta'), undefined, 'nothing changed, nothing sent')

  await send(g1, at('rock'))
  hub.tick(clock.tick(WORLD_TICK_MS))
  assert.deepEqual(wa.last('worldDelta').upsert.map((w) => [w.pid, w.station.id]), [[g1pid, 'rock']])
  assert.deepEqual(wa.last('worldDelta').remove, [])

  const late = await guest('other-ip')
  assert.equal(late.last('worldSnapshot').walkers.length, 2)

  close(g1)
  hub.tick(clock.tick(WORLD_TICK_MS))
  assert.deepEqual(wa.last('worldDelta').remove, [g1pid])
  assert.deepEqual(late.last('worldDelta').remove, [g1pid])
})

test('named, hidden and invisible: what strangers see', async () => {
  const { hub, clock, send, connect } = setup()
  const ada = await hub.register('Ada', 'ip', clock.now)
  const bob = await hub.register('Bob', 'ip', clock.now)
  const wa = await connect(ada, false, { v: 2, public: 'named' })
  const wb = await connect(bob, false, V2)
  await send(wa, at('jazz'))
  await send(wb, at('jazz'))
  hub.tick(clock.now)
  assert.deepEqual(wb.last('worldDelta').upsert.map((w) => w.name).sort(), ['Ada', null])

  await send(wa, { type: 'world', mode: 'hidden' })
  hub.tick(clock.tick(WORLD_TICK_MS))
  assert.equal(wb.last('worldDelta').remove.length, 1)
  assert.equal(wb.last('worldDelta').online, 1)

  await send(wa, { type: 'world', mode: 'anonymous' })
  await send(wb, { type: 'invisible', invisible: true })
  hub.tick(clock.tick(WORLD_TICK_MS))
  const walkers = hub.buildWorld().walkers
  assert.equal(walkers.length, 1, 'appear offline hides you from the world too')
  assert.equal(walkers[0].name, null)
})

test('friends learn each other\'s pid so the map draws them once', async () => {
  const { hub, clock, send, connect, sessions } = setup()
  const ada = await hub.register('Ada', 'ip', clock.now)
  const bob = await hub.register('Bob', 'ip', clock.now)
  const wa = await connect(ada, false, V2)
  const wb = await connect(bob, false, V2)
  await send(wa, { type: 'addFriend', code: bob.code })
  await send(wb, at('jazz'))
  assert.equal(wa.last('friend').friend.pid, sessions.get(wb).pid)
  hub.tick(clock.now)
  assert.ok(wa.last('worldDelta').upsert.some((w) => w.pid === sessions.get(wb).pid))
})

test('busy stations: walkers are capped per station and overall, crowds count everyone', async () => {
  const { hub, clock, send, guest } = setup()
  for (let i = 0; i < LIMITS.walkersPerStation + 4; i++) {
    const ws = await guest(`ip-${i}`)
    await send(ws, at('busy'))
    clock.tick(1)
  }
  const quiet = await guest('ip-quiet')
  await send(quiet, at('quiet', 10, 10))
  const world = hub.buildWorld()
  assert.equal(world.walkers.filter((w) => w.station.id === 'busy').length, LIMITS.walkersPerStation)
  assert.deepEqual(world.crowds.map((c) => [c.stationId, c.count]), [['busy', 12], ['quiet', 1]])
  assert.equal(world.online, 13)
})

test('guest connections are limited per network; presence floods are dropped', async () => {
  const { send, guest, clock, sessions } = setup()
  const guests = [await guest('home'), await guest('home'), await guest('home')]
  const extra = await guest('home')
  assert.equal(extra.closed, 4002)
  assert.equal((await guest('elsewhere')).closed, null)

  for (let i = 0; i < 15; i++) await send(guests[0], at(`s${i}`))
  assert.equal(sessions.get(guests[0]).presence.station.id, 's9', 'only 10 per 10 seconds')
  clock.tick(10_001)
  await send(guests[0], at('later'))
  assert.equal(sessions.get(guests[0]).presence.station.id, 'later')
})

test('ticks are spaced out', async () => {
  const { hub, clock, send, guest, ticks } = setup()
  const g = await guest()
  hub.tick(clock.now)
  ticks.length = 0
  await send(g, at('jazz'))
  assert.equal(ticks.at(-1), clock.now + WORLD_TICK_MS)
  clock.tick(WORLD_TICK_MS * 2)
  await send(g, at('rock'))
  assert.equal(ticks.at(-1), clock.now, 'long after the last tick: right away')
})

test('sessions stored before the public world get defaults and a pid', () => {
  const old = { userId: 'u1', invisible: false, presence: null, updatedAt: 5, adds: [] }
  const up = upgradeSession(old)
  assert.match(up.pid, /^[A-Za-z0-9_-]{12}$/)
  assert.equal(up.version, 1)
  assert.equal(up.publicMode, 'hidden')
  assert.equal(up.userId, 'u1')
  assert.equal(upgradeSession(up), up, 'already current')
  assert.equal(upgradeSession(null), null)
})

test('public names skip the word list', () => {
  assert.equal(publicName('Night Owl'), 'Night Owl')
  assert.equal(publicName('sh1t head'), null)
  assert.equal(publicName('  '), null)
})

const SETTINGS = { work: 25, short: 5, long: 15, longEvery: 2 }

async function roomSetup() {
  const ctx = setup()
  const { hub, clock, connect } = ctx
  const [ada, bob, cy] = [await hub.register('Ada', 'ip', clock.now), await hub.register('Bob', 'ip', clock.now), await hub.register('Cy', 'ip', clock.now)]
  const [wa, wb, wc] = [await connect(ada, false, V2), await connect(bob, false, V2), await connect(cy, false, V2)]
  return { ...ctx, ada, bob, cy, wa, wb, wc }
}

test('rooms: create, join by code, and everyone sees the same members', async () => {
  const { send, ada, bob, wa, wb } = await roomSetup()
  await send(wa, { type: 'createRoom', study: true, settings: SETTINGS })
  const room = wa.last('room').room
  assert.match(room.code, /^[0-9A-HJKMNP-TV-Z]{4}$/)
  assert.equal(room.host, ada.userId)
  assert.deepEqual(room.members.map((m) => m.name), ['Ada'])

  await send(wb, { type: 'joinRoom', code: `room-${room.code.toLowerCase()}` })
  assert.deepEqual(wa.last('room').room.members.map((m) => m.userId), [ada.userId, bob.userId])
  assert.deepEqual(wb.last('room').room.members.map((m) => m.name), ['Ada', 'Bob'])

  await send(wb, { type: 'joinRoom', code: 'ZZZZ' })
  assert.equal(wb.last('roomLeft').reason, 'not-found')
})

test('rooms: any member runs the shared timer; it advances on the server clock', async () => {
  const { hub, clock, send, wa, wb } = await roomSetup()
  await send(wa, { type: 'createRoom', study: true, settings: SETTINGS })
  await send(wb, { type: 'joinRoom', code: wa.last('room').room.code })

  await send(wb, { type: 'roomTimer', action: 'start' })
  let t = wa.last('room').room
  assert.equal(t.timer.phase, 'focus')
  assert.equal(t.timer.remainingMs, 25 * 60_000)
  assert.equal(t.lastAction.name, 'Bob')

  clock.tick(5 * 60_000)
  await send(wa, { type: 'roomTimer', action: 'pause' })
  t = wb.last('room').room
  assert.equal(t.timer.paused, true)
  assert.equal(t.timer.remainingMs, 20 * 60_000)
  clock.tick(60_000)
  await send(wa, { type: 'roomTimer', action: 'resume' })
  assert.equal(wb.last('room').room.timer.remainingMs, 20 * 60_000, 'paused time does not count')

  clock.tick(20 * 60_000)
  hub.tick(clock.now)
  t = wb.last('room').room
  assert.equal(t.timer.phase, 'break')
  assert.equal(t.timer.cycle, 1)
  assert.equal(t.timer.remainingMs, 5 * 60_000)

  clock.tick(5 * 60_000)
  hub.tick(clock.now)
  assert.equal(wb.last('room').room.timer.phase, 'idle')
  await send(wa, { type: 'roomTimer', action: 'start' })
  clock.tick(25 * 60_000)
  hub.tick(clock.now)
  t = wa.last('room').room
  assert.equal(t.timer.longBreak, true, 'every 2nd finished focus earns the long break')
  assert.equal(t.timer.remainingMs, 15 * 60_000)
  await send(wb, { type: 'roomTimer', action: 'stop' })
  assert.equal(wa.last('room').room.timer.phase, 'idle')
})

test('rooms: a listening room has no timer', async () => {
  const { send, wa } = await roomSetup()
  await send(wa, { type: 'createRoom', study: false, settings: SETTINGS })
  await send(wa, { type: 'roomTimer', action: 'start' })
  assert.equal(wa.last('room').room.timer.phase, 'idle')
})

test('rooms: only the host picks the station; members show whether they are there', async () => {
  const { send, ada, wa, wb } = await roomSetup()
  await send(wa, { type: 'createRoom', study: false, settings: SETTINGS })
  await send(wb, { type: 'joinRoom', code: wa.last('room').room.code })
  const jazz = at('jazz').presence.station
  await send(wb, { type: 'roomStation', station: jazz, mood: null })
  assert.equal(wa.last('room').room.station, null, 'a member cannot change it')
  await send(wa, { type: 'roomStation', station: jazz, mood: 'wx=rain.64.42&sky=night' })
  const room = wb.last('room').room
  assert.equal(room.station.id, 'jazz')
  assert.equal(room.mood, 'wx=rain.64.42&sky=night')
  assert.equal(room.lastAction.action, 'station')
  await send(wb, at('jazz'))
  await send(wa, { type: 'roomStation', station: jazz, mood: null })
  assert.deepEqual(wa.last('room').room.members.map((m) => [m.userId === ada.userId, m.here]), [[true, false], [false, true]])
})

test('rooms: invitations go only to friends', async () => {
  const { send, ada, bob, cy, wa, wb, wc } = await roomSetup()
  await send(wa, { type: 'addFriend', code: bob.code })
  await send(wa, { type: 'createRoom', study: false, settings: SETTINGS })
  await send(wa, { type: 'roomInvite', userId: bob.userId })
  const invite = wb.last('roomInvited')
  assert.equal(invite.code, wa.last('room').room.code)
  assert.deepEqual(invite.from, { userId: ada.userId, name: 'Ada' })
  await send(wa, { type: 'roomInvite', userId: cy.userId })
  assert.equal(wc.last('roomInvited'), undefined)
  assert.equal(wa.last('error').message, 'You can only invite friends')
})

test('rooms: the host hands over or leaves; an empty room expires', async () => {
  const { hub, clock, send, close, bob, cy, wa, wb, wc, repo } = await roomSetup()
  await send(wa, { type: 'createRoom', study: false, settings: SETTINGS })
  const code = wa.last('room').room.code
  await send(wb, { type: 'joinRoom', code })
  await send(wc, { type: 'joinRoom', code })
  await send(wb, { type: 'roomHost', userId: cy.userId })
  assert.notEqual(wb.last('room').room.host, cy.userId, 'only the host hands over')

  await send(wa, { type: 'leaveRoom' })
  assert.equal(wa.last('roomLeft').reason, 'left')
  assert.equal(wb.last('room').room.host, bob.userId, 'longest-present member takes over')
  await send(wb, { type: 'roomHost', userId: cy.userId })
  assert.equal(wc.last('room').room.host, cy.userId)

  close(wb)
  close(wc)
  assert.ok(repo.loadRoom(code).emptySince, 'kept for a while')
  clock.tick(ROOM_TTL_MS)
  hub.tick(clock.now)
  assert.equal(repo.loadRoom(code), null)
})

test('rooms: twelve members at most', async () => {
  const { hub, clock, send, connect, wa } = await roomSetup()
  await send(wa, { type: 'createRoom', study: false, settings: SETTINGS })
  const code = wa.last('room').room.code
  let last
  for (let i = 0; i < 12; i++) {
    const p = await hub.register(`P${i}`, `ip${i}`, clock.now)
    last = await connect(p, false, V2)
    await send(last, { type: 'joinRoom', code })
  }
  assert.equal(last.last('roomLeft').reason, 'full')
  assert.equal(wa.last('room').room.members.length, 12)
})

test('rooms: a host who reloads keeps the room; one who stays away hands it on', async () => {
  const { hub, clock, send, close, connect, ada, bob, wa, wb } = await roomSetup()
  await send(wa, { type: 'createRoom', study: true, settings: SETTINGS })
  const code = wa.last('room').room.code
  await send(wb, { type: 'joinRoom', code })
  await send(wb, { type: 'roomTimer', action: 'start' })

  close(wa)
  assert.equal(wb.last('room').room.host, ada.userId, 'still the host during the grace period')
  clock.tick(HOST_GRACE_MS / 2)
  const wa2 = await connect(ada, false, V2)
  await send(wa2, { type: 'joinRoom', code })
  clock.tick(HOST_GRACE_MS)
  hub.tick(clock.now)
  assert.equal(wb.last('room').room.host, ada.userId, 'back in time')

  close(wa2)
  clock.tick(HOST_GRACE_MS)
  hub.tick(clock.now)
  const room = wb.last('room').room
  assert.equal(room.host, bob.userId, 'gone too long: the next member hosts')
  assert.equal(room.timer.phase, 'focus', 'the timer kept running')
})
