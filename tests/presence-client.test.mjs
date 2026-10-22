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
  assert.deepEqual(ws.sent[0], { type: 'hello', token: identity.token, invisible: false })
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
  assert.equal(FakeWS.instances.length, 3)
})

test('a failed registration reports the server message', async (t) => {
  const client = setup(t, async () => { throw new Error('Too many new profiles') })
  await client.signIn('Ada')
  await flush()
  assert.equal(state().friends.status, 'signed-out')
  assert.equal(state().friends.error, 'Too many new profiles')
})
