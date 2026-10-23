import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Hub, HubError } from '../worker/src/core.ts'
import { EMPTY_PROGRESS } from '../src/avatar/unlocks.ts'
import { mergeAccountData, sanitizeAccountData } from '../src/social/accountData.ts'
import { AccountSync } from '../src/social/AccountSync.ts'
import { ApiError } from '../src/social/identity.ts'
import { normalizeUsername } from '../src/social/protocol.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { MemoryRepo, station } from './helpers.mjs'

class FakeSocket {
  sent = []
  send(data) { this.sent.push(JSON.parse(data)) }
  close(code) { this.closed = code }
}

function setup() {
  const repo = new MemoryRepo()
  const map = new Map()
  const hub = new Hub(repo, { get: (ws) => map.get(ws) ?? null, set: (ws, s) => map.set(ws, s), all: () => [...map.keys()] })
  const hello = async (token) => {
    const ws = new FakeSocket()
    await hub.message(ws, JSON.stringify({ type: 'hello', token, invisible: false }), 1)
    return ws
  }
  return { hub, repo, hello }
}

const rejects = (promise, status) => assert.rejects(promise, (err) => err instanceof HubError && err.status === status)

test('usernames are normalised and validated', () => {
  assert.equal(normalizeUsername('  Night.Owl_7 '), 'night.owl_7')
  assert.equal(normalizeUsername('ab'), null)
  assert.equal(normalizeUsername('has space'), null)
  assert.equal(normalizeUsername('x'.repeat(21)), null)
})

test('signing up turns an existing profile into an account and keeps its friends', async () => {
  const { hub, repo, hello } = setup()
  const ada = await hub.register('Ada', 'ip', 0)
  const bo = await hub.register('Bo', 'ip', 0)
  repo.addFriendship(ada.userId, bo.userId)
  await rejects(hub.signup({ username: 'ada', password: 'short' }, ada.token, 'ip', 0), 400)
  await rejects(hub.signup({ username: 'a d', password: 'long enough' }, ada.token, 'ip', 0), 400)
  await rejects(hub.signup({ username: 'ada', password: 'long enough' }, 'x'.repeat(43), 'ip', 0), 401)

  const account = await hub.signup({ username: 'Ada', password: 'correct horse' }, ada.token, 'ip', 0)
  assert.deepEqual([account.userId, account.code, account.token, account.username], [ada.userId, ada.code, ada.token, 'ada'])
  assert.ok(!repo.accountOf(ada.userId).passHash.includes('correct'))
  await rejects(hub.signup({ username: 'ada2', password: 'correct horse' }, ada.token, 'ip', 0), 409)
  await rejects(hub.signup({ username: 'ADA', password: 'another one', name: 'Imposter' }, null, 'ip', 0), 409)

  // The welcome tells the owner their username, but friends never see it
  const ws = await hello(ada.token)
  const welcome = ws.sent.find((m) => m.type === 'welcome')
  assert.equal(welcome.self.username, 'ada')
  assert.deepEqual(welcome.friends.map((f) => f.userId), [bo.userId])
  const boWs = await hello(bo.token)
  assert.equal(boWs.sent.find((m) => m.type === 'welcome').friends[0].username, null)
})

test('signing up without a profile creates one', async () => {
  const { hub, repo } = setup()
  await rejects(hub.signup({ username: 'cy', password: 'long enough' }, null, 'ip', 0), 400)
  const cy = await hub.signup({ username: 'cyd', password: 'long enough', name: 'Cy' }, null, 'ip', 0)
  assert.equal(cy.name, 'Cy')
  assert.equal(repo.accountOf(cy.userId).username, 'cyd')
})

test('logging in gives each device its own token; logging out revokes only that one', async () => {
  const { hub, hello } = setup()
  const ada = await hub.register('Ada', 'ip', 0)
  await hub.signup({ username: 'ada', password: 'correct horse' }, ada.token, 'ip', 0)
  await rejects(hub.login({ username: 'ada', password: 'wrong horse' }, 'ip', 0), 401)
  await rejects(hub.login({ username: 'nobody', password: 'correct horse' }, 'ip', 0), 401)

  const phone = await hub.login({ username: 'ADA', password: 'correct horse' }, 'ip2', 0)
  assert.equal(phone.userId, ada.userId)
  assert.notEqual(phone.token, ada.token)
  assert.deepEqual([phone.data, phone.rev], [null, 0])
  assert.equal((await hello(phone.token)).sent[0].type, 'welcome')

  await hub.logout(phone.token)
  assert.equal((await hello(phone.token)).closed, 4001)
  assert.equal((await hello(ada.token)).sent[0].type, 'welcome')
})

test('logins are rate limited per network and username', async () => {
  const { hub } = setup()
  const ada = await hub.register('Ada', 'ip', 0)
  await hub.signup({ username: 'ada', password: 'correct horse' }, ada.token, 'ip', 0)
  for (let i = 0; i < 10; i++) await rejects(hub.login({ username: 'ada', password: 'guess ' + i }, 'bad', 1000), 401)
  await rejects(hub.login({ username: 'ada', password: 'correct horse' }, 'bad', 1000), 429)
  // Other networks aren't affected, and the window passes
  assert.ok((await hub.login({ username: 'ada', password: 'correct horse' }, 'good', 1000)).token)
  assert.ok((await hub.login({ username: 'ada', password: 'correct horse' }, 'bad', 1000 + 16 * 60_000)).token)
})

test('synced data is versioned; a stale save gets the newer copy back', async () => {
  const { hub } = setup()
  const ada = await hub.register('Ada', 'ip', 0)
  await rejects(hub.getData(ada.token), 404)
  await hub.signup({ username: 'ada', password: 'correct horse' }, ada.token, 'ip', 0)
  assert.deepEqual(await hub.getData(ada.token), { data: null, rev: 0 })
  await rejects(hub.putData({ data: [1, 2], rev: 0 }, ada.token), 400)
  await rejects(hub.putData({ data: { big: 'x'.repeat(70_000) }, rev: 0 }, ada.token), 413)
  assert.deepEqual(await hub.putData({ data: { v: 1, n: 1 }, rev: 0 }, ada.token), { rev: 1 })
  const conflict = await hub.putData({ data: { v: 1, n: 2 }, rev: 0 }, ada.token).catch((e) => e)
  assert.equal(conflict.status, 409)
  assert.deepEqual(conflict.body, { data: { v: 1, n: 1 }, rev: 1 })
  const phone = await hub.login({ username: 'ada', password: 'correct horse' }, 'ip', 0)
  assert.deepEqual([phone.data, phone.rev], [{ v: 1, n: 1 }, 1])
})

// --- Client side ---

const avatar = { head: 1, hat: 2, shirt: 3, pants: 4, shoes: 5 }
const blob = (patch = {}) => ({
  v: 1,
  library: { favorites: [], recents: [] },
  avatar,
  unlocks: [],
  progress: EMPTY_PROGRESS,
  ...patch,
})

test('account data is sanitized and merged', () => {
  assert.equal(sanitizeAccountData({ avatar: 'x' }), null)
  const clean = sanitizeAccountData({ avatar, library: { favorites: [station('a'), { id: 5 }] }, unlocks: ['sailor', 'nope'], progress: { flights: 2 } })
  assert.deepEqual(clean.library.favorites.map((s) => s.id), ['a'])
  assert.deepEqual(clean.unlocks, ['sailor'])
  assert.equal(clean.progress.flights, 2)

  const local = blob({ library: { favorites: [station('a'), station('b')], recents: [] }, unlocks: ['pilot'], progress: { ...EMPTY_PROGRESS, flights: 5, countries: ['JP'] } })
  const remote = blob({ avatar: { ...avatar, hat: 0 }, library: { favorites: [station('c'), station('a')], recents: [] }, unlocks: ['sailor'], progress: { ...EMPTY_PROGRESS, flights: 1, boatTrips: 4, countries: ['FR'] } })
  const merged = mergeAccountData(local, remote, { preferRemoteAvatar: true })
  assert.deepEqual(merged.library.favorites.map((s) => s.id), ['c', 'a', 'b'])
  assert.deepEqual(merged.unlocks.sort(), ['pilot', 'sailor'])
  assert.deepEqual([merged.progress.flights, merged.progress.boatTrips, merged.progress.countries], [5, 4, ['JP', 'FR']])
  assert.equal(merged.avatar.hat, 0)
  assert.equal(mergeAccountData(local, remote, { preferRemoteAvatar: false }).avatar.hat, 2)
})

const state = () => useRadioStore.getState()
beforeEach(() => {
  const data = new Map()
  globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }
  useRadioStore.setState(useRadioStore.getInitialState(), true)
})

/** A fake server holding one versioned blob. */
function fakeServer() {
  const server = { data: null, rev: 0, saves: 0 }
  server.fetchData = async () => ({ data: server.data, rev: server.rev })
  server.saveData = async (_url, _token, data, rev) => {
    if (rev !== server.rev) throw new ApiError(409, 'conflict', { data: server.data, rev: server.rev })
    server.saves++
    server.data = JSON.parse(JSON.stringify(data))
    return ++server.rev
  }
  return server
}

const identity = { userId: 'me', name: 'Ada', code: '7K3Q9XZT', token: 't'.repeat(43), username: 'ada' }

test('signing in merges this device with the account, then later edits save', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const server = fakeServer()
  server.data = blob({ avatar: { ...avatar, hat: 1 }, library: { favorites: [station('remote')], recents: [] } })
  server.rev = 3
  const sync = new AccountSync({ url: 'https://x.test', identity: () => identity, fetchData: server.fetchData, saveData: server.saveData })
  const stop = sync.start()
  state().toggleFavorite(station('local'))

  await sync.begin({ data: server.data, rev: server.rev })
  assert.deepEqual(state().library.favorites.map((s) => s.id), ['remote', 'local'])
  assert.equal(state().avatar.hat, 1, "the account's avatar wins on sign-in")
  assert.equal(server.rev, 4)
  assert.deepEqual(server.data.library.favorites.map((s) => s.id), ['remote', 'local'])
  assert.equal(state().account.status, 'synced')

  state().removeFavorite('remote')
  t.mock.timers.tick(3000)
  await sync.flush()
  assert.deepEqual(server.data.library.favorites.map((s) => s.id), ['local'])
  stop()
})

test('a pull with no local edits takes the server copy as is, so removals spread', async () => {
  const server = fakeServer()
  const sync = new AccountSync({ url: 'https://x.test', identity: () => identity, fetchData: server.fetchData, saveData: server.saveData })
  state().toggleFavorite(station('a'))
  state().toggleFavorite(station('b'))
  await sync.begin(null)
  assert.equal(server.saves, 1)
  // Another device removes "a"
  server.data = { ...server.data, library: { favorites: [station('b')], recents: [] } }
  server.rev++
  await sync.pull()
  assert.deepEqual(state().library.favorites.map((s) => s.id), ['b'])
  assert.equal(server.saves, 1, 'nothing new to save')
})

test('a conflicting save merges with the newer copy and retries', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const server = fakeServer()
  const sync = new AccountSync({ url: 'https://x.test', identity: () => identity, fetchData: server.fetchData, saveData: server.saveData })
  const stop = sync.start()
  await sync.begin(null)
  // Meanwhile another device adds "phone"; this one adds "desk"
  server.data = { ...server.data, library: { favorites: [station('phone')], recents: [] } }
  server.rev++
  state().toggleFavorite(station('desk'))
  state().recordRide('boat')
  t.mock.timers.tick(3000)
  await sync.flush()
  assert.deepEqual(server.data.library.favorites.map((s) => s.id).sort(), ['desk', 'phone'])
  assert.equal(server.data.progress.boatTrips, 1)
  assert.deepEqual(state().library.favorites.map((s) => s.id).sort(), ['desk', 'phone'])
  stop()
})

test('sync stays idle without an account and reports errors', async () => {
  let calls = 0
  const none = new AccountSync({ url: 'https://x.test', identity: () => ({ ...identity, username: null }), fetchData: async () => (calls++, null) })
  await none.pull()
  assert.equal(calls, 0)
  const broken = new AccountSync({ url: 'https://x.test', identity: () => identity, fetchData: async () => { throw new Error('offline') } })
  await broken.pull()
  assert.deepEqual([state().account.status, state().account.error], ['error', 'offline'])
})

test('signing in on a device switches the socket to the account and pulls its data', async (t) => {
  const { PresenceClient } = await import('../src/social/PresenceClient.ts')
  const sockets = []
  class WS {
    readyState = 0
    sent = []
    constructor(url) { this.url = url; sockets.push(this) }
    send(data) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3 }
  }
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push([url, init.method, init.headers.authorization ?? null])
    const body = url.endsWith('/login')
      ? { ...identity, token: 'p'.repeat(43), data: blob({ library: { favorites: [station('cloud')], recents: [] } }), rev: 2 }
      : { rev: 3 }
    return { ok: true, status: 200, json: async () => body }
  })
  const client = new PresenceClient({ url: 'https://x.test', WebSocketImpl: WS })
  t.after(client.connect())
  assert.equal(state().friends.status, 'signed-out')
  await client.logIn('Ada', 'correct horse')
  assert.equal(client.current.username, 'ada')
  assert.equal(JSON.parse(globalThis.localStorage.getItem('pixel-radio.identity')).token, 'p'.repeat(43))
  assert.equal(sockets.length, 1)
  sockets[0].readyState = 1
  sockets[0].onopen()
  assert.deepEqual(sockets[0].sent[0], { type: 'hello', token: 'p'.repeat(43), invisible: false })
  assert.deepEqual(state().library.favorites.map((s) => s.id), ['cloud'])
  // This device had nothing the account lacked, so there was nothing to save back
  assert.deepEqual(requests.map(([url, method]) => [url, method]), [['https://x.test/api/account/login', 'POST']])

  await client.signOut()
  assert.equal(state().friends.status, 'signed-out')
  assert.equal(globalThis.localStorage.getItem('pixel-radio.identity'), null)
  assert.deepEqual(requests.at(-1), ['https://x.test/api/account/logout', 'POST', `Bearer ${'p'.repeat(43)}`])
  // The local copy stays after signing out
  assert.deepEqual(state().library.favorites.map((s) => s.id), ['cloud'])
})
