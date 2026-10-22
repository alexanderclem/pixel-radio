import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { PresenceClient } from '../src/social/PresenceClient.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { flush, station } from './helpers.mjs'

class FakeWS {
  static instances = []
  readyState = 0
  sent = []
  constructor(url) {
    this.url = url
    FakeWS.instances.push(this)
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(msg) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  last(type) { return this.sent.filter((m) => m.type === type).at(-1) }
}

const state = () => useRadioStore.getState()
const self = { userId: 'me', name: 'Ada', code: '7K3Q9XZT' }
const identity = { ...self, token: 't'.repeat(43) }
const friend = (userId, name, online, presence = null) => ({ userId, name, code: '7K3Q9XZA', online, presence })

beforeEach(() => {
  FakeWS.instances = []
  const data = new Map()
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
  useRadioStore.setState(useRadioStore.getInitialState(), true)
})

function setup(t, register = async () => identity) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const client = new PresenceClient({ url: 'https://presence.test', WebSocketImpl: FakeWS, register })
  const disconnect = client.connect()
  t.after(() => {
    disconnect()
    delete globalThis.localStorage
  })
  return client
}

test('without a server URL friends are reported as unconfigured', (t) => {
  const client = new PresenceClient({ url: '', WebSocketImpl: FakeWS })
  t.after(client.connect())
  assert.equal(state().friends.status, 'unconfigured')
  assert.equal(FakeWS.instances.length, 0)
})

test('joining registers, says hello and mirrors the friend list', async (t) => {
  const client = setup(t)
  assert.equal(state().friends.status, 'signed-out')
  await client.signIn('Ada')
  const ws = FakeWS.instances[0]
  assert.equal(ws.url, 'wss://presence.test/api/ws')
  assert.equal(JSON.parse(globalThis.localStorage.getItem('pixel-radio.identity')).code, identity.code)
  ws.open()
  assert.deepEqual(ws.sent[0], { type: 'hello', token: identity.token, invisible: false, v: 2, public: 'anonymous' })
  ws.receive({ type: 'welcome', self, friends: [friend('b', 'Zed', true), friend('c', 'Bob', false), friend('d', 'Cy', true)] })
  assert.equal(state().friends.status, 'online')
  assert.deepEqual(state().friends.list.map((f) => f.name), ['Cy', 'Zed', 'Bob'])
  assert.ok(ws.last('presence'), 'publishes presence right after welcome')

  ws.receive({ type: 'friend', friend: friend('c', 'Bob', true) })
  assert.deepEqual(state().friends.list.map((f) => f.name), ['Bob', 'Cy', 'Zed'])
  ws.receive({ type: 'friendRemoved', userId: 'b' })
  assert.deepEqual(state().friends.list.map((f) => f.name), ['Bob', 'Cy'])
  ws.receive({ type: 'error', reason: 'not-found', message: 'No one has that code' })
  assert.equal(state().friends.error, 'No one has that code')
})

test('presence is debounced, carries no stream URL and respects share/appear-offline', async (t) => {
  globalThis.localStorage.setItem('pixel-radio.identity', JSON.stringify(identity))
  setup(t)
  const ws = FakeWS.instances[0]
  ws.open()
  ws.receive({ type: 'welcome', self, friends: [] })
  ws.sent = []

  state().setStation(station('jazz', { lat: 48.8, lon: 2.3, location: 'Paris, France' }), 0, true)
  state().setTune('playing', 'LIVE')
  state().setFocus({ phase: 'focus', endsAt: Date.now() + 60_000 })
  assert.equal(ws.sent.length, 0)
  t.mock.timers.tick(1000)
  assert.equal(ws.sent.filter((m) => m.type === 'presence').length, 1)
  const sent = ws.last('presence').presence
  assert.equal(sent.station.id, 'jazz')
  assert.equal('url' in sent.station, false)
  assert.equal(sent.focus.phase, 'focus')

  state().setSocial({ shareListening: false })
  t.mock.timers.tick(1000)
  assert.equal(ws.last('presence').presence.station, null)

  state().setSocial({ appearOffline: true })
  assert.deepEqual(ws.last('invisible'), { type: 'invisible', invisible: true })
})

test('drops reconnect with backoff; an unknown profile signs out', async (t) => {
  globalThis.localStorage.setItem('pixel-radio.identity', JSON.stringify(identity))
  setup(t)
  FakeWS.instances[0].open()
  FakeWS.instances[0].drop()
  assert.equal(state().friends.status, 'offline')
  t.mock.timers.tick(1300)
  assert.equal(FakeWS.instances.length, 2)
  FakeWS.instances[1].drop()
  t.mock.timers.tick(1300)
  assert.equal(FakeWS.instances.length, 2, 'second retry waits longer')
  t.mock.timers.tick(1300)
  assert.equal(FakeWS.instances.length, 3)

  FakeWS.instances[2].open()
  FakeWS.instances[2].drop(4001)
  assert.equal(state().friends.status, 'signed-out')
  assert.equal(globalThis.localStorage.getItem('pixel-radio.identity'), null)
  t.mock.timers.tick(60_000)
  assert.equal(FakeWS.instances.length, 4, 'carries on as a guest')
  FakeWS.instances[3].open()
  assert.equal(FakeWS.instances[3].sent[0].type, 'guest')
  FakeWS.instances[3].drop(4002)
  t.mock.timers.tick(60_000)
  assert.equal(FakeWS.instances.length, 4, 'a refused guest stops knocking')
})

test('a failed registration reports the server message', async (t) => {
  const client = setup(t, async () => { throw new Error('Too many new profiles') })
  await client.signIn('Ada')
  await flush()
  assert.equal(state().friends.status, 'signed-out')
  assert.equal(state().friends.error, 'Too many new profiles')
})

test('an invite link adds the friend once connected, even after signing up', async (t) => {
  const client = setup(t)
  client.acceptInvite('7K3Q9XZA')
  assert.equal(state().friends.invite, '7K3Q9XZA')
  await client.signIn('Ada')
  const ws = FakeWS.instances[0]
  ws.open()
  ws.receive({ type: 'welcome', self, friends: [] })
  assert.deepEqual(ws.last('addFriend'), { type: 'addFriend', code: '7K3Q9XZA' })
  ws.receive({ type: 'friend', friend: friend('b', 'Bob', true) })
  assert.equal(state().friends.invite, null)
  assert.equal(state().toast.text, 'You and Bob are now friends')

  // Reconnecting doesn't send it again
  ws.sent = []
  ws.receive({ type: 'welcome', self, friends: [friend('b', 'Bob', true)] })
  assert.equal(ws.last('addFriend'), undefined)
})

test('a bad invite is dropped, and your own is ignored', async (t) => {
  globalThis.localStorage.setItem('pixel-radio.identity', JSON.stringify(identity))
  const client = setup(t)
  const ws = FakeWS.instances[0]
  ws.open()
  ws.receive({ type: 'welcome', self, friends: [] })
  client.acceptInvite(self.code)
  assert.equal(state().friends.invite, null)
  client.acceptInvite('7K3Q9XZB')
  assert.deepEqual(ws.last('addFriend'), { type: 'addFriend', code: '7K3Q9XZB' }, 'sent straight away when online')
  ws.receive({ type: 'error', reason: 'not-found', message: 'No one has that code' })
  assert.equal(state().friends.invite, null)
})

const walker = (pid, stationId = 's1', patch = {}) => ({
  pid, name: null, avatar: { head: 0, hat: 0, shirt: 0, pants: 0, shoes: 0 },
  station: { id: stationId, name: 'Jazz FM', song: null, location: 'Paris', lat: 48.8, lon: 2.3 }, focus: null, ...patch,
})

test('without a profile it joins the world as a guest and publishes presence', (t) => {
  setup(t)
  const ws = FakeWS.instances[0]
  ws.open()
  assert.deepEqual(ws.sent[0], { type: 'guest', v: 2, public: 'anonymous' })
  assert.equal(ws.sent[1].type, 'presence', 'guests appear straight away')
  assert.equal(state().friends.status, 'signed-out')

  ws.receive({ type: 'worldSnapshot', pid: 'mememememe12', walkers: [walker('aaaaaaaaaaaa'), walker('bbbbbbbbbbbb')], crowds: [], online: 2 })
  assert.equal(state().world.pid, 'mememememe12')
  assert.equal(state().world.synced, true)
  assert.deepEqual(Object.keys(state().world.walkers).sort(), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
  ws.receive({ type: 'worldDelta', upsert: [walker('aaaaaaaaaaaa', 's2'), walker('cccccccccccc')], remove: ['bbbbbbbbbbbb'], crowds: [], online: 2 })
  assert.equal(state().world.walkers.aaaaaaaaaaaa.station.id, 's2')
  assert.deepEqual(Object.keys(state().world.walkers).sort(), ['aaaaaaaaaaaa', 'cccccccccccc'])
  assert.equal(state().world.online, 2)

  state().setSocial({ publicMode: 'hidden' })
  assert.deepEqual(ws.last('world'), { type: 'world', mode: 'hidden' })
  ws.drop()
  assert.equal(state().world.synced, false)
})

test('signing up upgrades the open guest connection', async (t) => {
  const client = setup(t)
  const ws = FakeWS.instances[0]
  ws.open()
  await client.signIn('Ada')
  assert.equal(FakeWS.instances.length, 1, 'no second socket')
  assert.equal(ws.last('hello').token, identity.token)
  ws.receive({ type: 'welcome', self, friends: [] })
  assert.equal(state().friends.status, 'online')

  client.signOut()
  assert.equal(FakeWS.instances.length, 2, 'back in the world as a guest')
  FakeWS.instances[1].open()
  assert.equal(FakeWS.instances[1].sent[0].type, 'guest')
})

const roomFrame = (patch = {}) => ({
  code: 'K7Q3', host: 'me', study: true,
  members: [{ userId: 'me', name: 'Ada', avatar: { head: 0, hat: 0, shirt: 0, pants: 0, shoes: 0 }, here: true }],
  timer: { phase: 'idle', remainingMs: 0, paused: false, cycle: 0, longBreak: false },
  settings: { work: 50, short: 10, long: 20, longEvery: 4 },
  station: null, mood: null, lastAction: null, ...patch,
})

function onlineClient(t) {
  globalThis.localStorage.setItem('pixel-radio.identity', JSON.stringify(identity))
  const client = setup(t)
  const ws = FakeWS.instances[0]
  ws.open()
  ws.receive({ type: 'welcome', self, friends: [] })
  return { client, ws }
}

test('a study room drives the focus timer and gives your own lengths back on leaving', (t) => {
  const { client, ws } = onlineClient(t)
  client.createRoom(true)
  assert.deepEqual(ws.last('createRoom'), { type: 'createRoom', study: true, settings: { work: 25, short: 5, long: 15, longEvery: 4 } })
  ws.receive({ type: 'room', room: roomFrame() })
  assert.equal(state().focus.settings.work, 50, 'the room lengths apply')

  ws.receive({ type: 'room', room: roomFrame({ timer: { phase: 'focus', remainingMs: 50 * 60_000, paused: false, cycle: 0, longBreak: false } }) })
  assert.equal(state().focus.phase, 'focus')
  assert.ok(state().focus.endsAt > Date.now() + 49 * 60_000)

  // The timer buttons now drive the room
  ws.sent = []
  ws.receive({ type: 'room', room: roomFrame({ timer: { phase: 'break', remainingMs: 10 * 60_000, paused: false, cycle: 1, longBreak: false } }) })
  assert.equal(state().focus.completed, 1, 'a finished room focus counts')

  client.leaveRoom()
  assert.deepEqual(ws.last('leaveRoom'), { type: 'leaveRoom' })
  assert.equal(state().room, null)
  assert.equal(state().focus.phase, 'idle')
  assert.equal(state().focus.settings.work, 25)
})

test('members follow the host only when the host changes station', async (t) => {
  const { ws } = onlineClient(t)
  state().setPowered(true)
  const jazz = { id: 'rp-main', name: 'Radio Paradise', song: null, location: 'Paradise', country: 'US', lat: null, lon: null, curated: true }
  ws.receive({ type: 'room', room: roomFrame({ host: 'someone-else', study: false }) })
  ws.receive({ type: 'room', room: roomFrame({ host: 'someone-else', study: false, station: jazz }) })
  await flush()
  assert.equal(state().stationRequest.station.id, 'rp-main')
  const nonce = state().stationRequest.nonce
  ws.receive({ type: 'room', room: roomFrame({ host: 'someone-else', study: false, station: jazz, members: [] }) })
  await flush()
  assert.equal(state().stationRequest.nonce, nonce, 'no re-tune on other updates')

  state().setSocial({ followRoom: false })
  ws.receive({ type: 'room', room: roomFrame({ host: 'someone-else', study: false, station: { ...jazz, id: 'rp-mellow' } }) })
  await flush()
  assert.equal(state().stationRequest.nonce, nonce, 'not following')
})

test('the host shares the station they tune to', (t) => {
  const { ws } = onlineClient(t)
  ws.receive({ type: 'room', room: roomFrame({ study: false }) })
  state().setStation(station('kexp', { lat: 47.6, lon: -122.3 }), 0, true)
  state().setTune('playing', 'LIVE')
  const sent = ws.last('roomStation')
  assert.equal(sent.station.id, 'kexp')
  assert.equal('url' in sent.station, false)
  assert.match(sent.mood, /wx=auto/)
})

test('invitations wait for an answer; a room link waits for the profile', async (t) => {
  const client = setup(t)
  client.joinRoom('K7Q3')
  const ws = FakeWS.instances[0]
  ws.open()
  assert.equal(ws.last('joinRoom'), undefined, 'guests cannot join yet')
  await client.signIn('Ada')
  ws.receive({ type: 'welcome', self, friends: [] })
  assert.deepEqual(ws.last('joinRoom'), { type: 'joinRoom', code: 'K7Q3' })

  ws.receive({ type: 'roomInvited', code: 'ABCD', from: { userId: 'bob', name: 'Bob' }, station: null })
  assert.equal(state().roomInvites[0].from.name, 'Bob')
  assert.equal(ws.last('joinRoom').code, 'K7Q3', 'an invitation never joins by itself')
  client.declineRoom('ABCD')
  assert.equal(state().roomInvites.length, 0)
  ws.receive({ type: 'roomLeft', reason: 'not-found' })
  assert.equal(state().toast.text, 'That room has closed')
})

test('an older friends server: guests stop quietly and rooms stay hidden', async (t) => {
  const client = setup(t)
  const ws = FakeWS.instances[0]
  ws.open()
  ws.receive({ type: 'error', reason: 'invalid', message: 'Malformed message' })
  assert.equal(state().friends.error, null, 'no confusing error')
  t.mock.timers.tick(60_000)
  assert.equal(FakeWS.instances.length, 1, 'no reconnect loop as a guest')

  await client.signIn('Ada')
  assert.equal(FakeWS.instances.length, 2, 'signing in still connects')
  FakeWS.instances[1].open()
  FakeWS.instances[1].receive({ type: 'welcome', self, friends: [] })
  assert.equal(state().friends.serverVersion, 1)
})
