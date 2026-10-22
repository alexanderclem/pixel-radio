import { test } from 'node:test'
import assert from 'node:assert/strict'
import { consumeDeepLink, inviteLink, parseDeepLink, roomLink, stationLink } from '../src/routing/deepLink.ts'
import { cardLines, cropFor } from '../src/share/card.ts'
import { normalizeRoomCode } from '../src/social/protocol.ts'
import { lookupStation, stationMeta } from '../worker/src/stationPage.ts'

test('shared paths parse into stations, invites and rooms', () => {
  assert.deepEqual(parseDeepLink('/s/9617a958-0601-11e8-ae97-52543be04c81'), { kind: 'station', id: '9617a958-0601-11e8-ae97-52543be04c81', session: null })
  assert.deepEqual(parseDeepLink('/s/rp-main/'), { kind: 'station', id: 'rp-main', session: null }, 'trailing slash')
  assert.deepEqual(parseDeepLink('/f/pr-7k3q-9xzt'), { kind: 'friend', code: '7K3Q9XZT' })
  assert.deepEqual(parseDeepLink('/r/k7q3'), { kind: 'room', code: 'K7Q3' })
  for (const bad of ['/', '/s/', '/s/bad id', '/s/%E0%A4%A', '/f/nope', '/r/TOOLONG', '/x/abc', '/s/a/b']) {
    assert.equal(parseDeepLink(bad), null, bad)
  }
  assert.equal(normalizeRoomCode('room-k7q3'), 'K7Q3')
  assert.equal(normalizeRoomCode('ROOM OIL3'), '0113', 'look-alikes')
  assert.equal(normalizeRoomCode('K7Q'), null)
})

test('a link is read once and the address bar goes back to the root', () => {
  const calls = []
  const hist = { replaceState: (...args) => calls.push(args) }
  assert.deepEqual(consumeDeepLink({ pathname: '/s/rp-main', search: '' }, hist), { kind: 'station', id: 'rp-main', session: null })
  assert.deepEqual(calls, [[null, '', '/']])
  assert.equal(consumeDeepLink({ pathname: '/nope', search: '' }, hist), null)
  assert.equal(calls.length, 2, 'unknown paths are tidied too')
  assert.equal(consumeDeepLink({ pathname: '/', search: '' }, hist), null)
  assert.equal(calls.length, 2)
})

test('links are built from the site origin', () => {
  assert.equal(stationLink('rp-main', 'https://pixelradios.com'), 'https://pixelradios.com/s/rp-main')
  assert.equal(inviteLink('7K3Q9XZT', 'https://pixelradios.com'), 'https://pixelradios.com/f/7K3Q9XZT')
  assert.equal(roomLink('K7Q3', 'https://pixelradios.com'), 'https://pixelradios.com/r/K7Q3')
})

const avatar = { head: 0, hat: 0, shirt: 0, pants: 0, shoes: 0 }

test('share cards say what, where and when', () => {
  const lines = cardLines({
    stationName: 'KEXP', place: 'Seattle, Washington', lat: 47.6, lon: -122.3, song: 'Khruangbin - Maria También',
    time: '07:12', weather: 'RAIN 52°F', avatar, url: 'https://pixelradios.com/s/abc',
  })
  assert.equal(lines.song, '♪ Khruangbin - Maria También')
  assert.equal(lines.details, 'SEATTLE, WASHINGTON · 07:12 · RAIN 52°F')
  assert.equal(lines.url, 'pixelradios.com/s/abc')
  const bare = cardLines({ stationName: 'X', place: 'Paris', lat: null, lon: null, song: null, time: null, weather: null, avatar, url: 'http://x/s/1' })
  assert.equal(bare.song, null)
  assert.equal(bare.details, 'PARIS')
})

test('the card crops the map around the station, staying inside the buffer', () => {
  const view = { width: 640, height: 300, project: (lon, lat) => [lon, lat] }
  assert.deepEqual(cropFor(view, 100, 300), { x: 225, y: 21, w: 150, h: 158 })
  assert.deepEqual(cropFor(view, 5, 5), { x: 0, y: 0, w: 150, h: 158 }, 'clamped at the corner')
  assert.deepEqual(cropFor(view, 50, 9999), { x: 245, y: 71, w: 150, h: 158 }, 'off-screen station: the middle')
  assert.deepEqual(cropFor({ ...view, width: 100, height: 80 }, null, null), { x: 0, y: 0, w: 100, h: 80 }, 'tiny maps use everything')
})

test('station link previews name the station', async () => {
  const meta = stationMeta({ name: 'KEXP', location: 'Washington, United States' }, 'abc', 'https://pixelradios.com')
  assert.equal(meta.title, 'KEXP · Pixel Radio')
  assert.match(meta.description, /KEXP, live from Washington, United States/)
  assert.equal(meta.url, 'https://pixelradios.com/s/abc')
  assert.equal(meta.image, 'https://pixelradios.com/og-image.png')
  assert.equal(stationMeta(null, 'abc', 'https://x').title, 'Pixel Radio')

  assert.equal((await lookupStation('rp-main', 0)).name, 'Radio Paradise · Main Mix', 'curated ids need no lookup')
  let calls = 0
  const fetchImpl = async () => {
    calls++
    return { ok: true, json: async () => [{ stationuuid: 'uuid-1', name: ' KEXP ', state: 'Washington', country: 'United States' }] }
  }
  assert.deepEqual(await lookupStation('uuid-1', 0, fetchImpl), { name: 'KEXP', location: 'Washington, United States' })
  await lookupStation('uuid-1', 1000, fetchImpl)
  assert.equal(calls, 1, 'cached for a day')
  assert.equal(await lookupStation('uuid-2', 0, async () => { throw new Error('down') }), null)
  assert.equal(await lookupStation('uuid-3', 0, async () => ({ ok: true, json: async () => [] })), null)
})
