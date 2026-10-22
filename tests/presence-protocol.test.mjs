import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCode, generateCode, normalizeCode, normalizeName, parseClientMessage, parseServerMessage } from '../src/social/protocol.ts'
import { friendStatus } from '../src/social/friendStatus.ts'
import { presenceOrigin } from '../src/social/identity.ts'

test('friend codes are 8 Crockford characters and normalise forgivingly', () => {
  for (let i = 0; i < 50; i++) assert.match(generateCode(), /^[0-9A-HJKMNP-TV-Z]{8}$/)
  assert.equal(formatCode('7K3Q9XZT'), 'PR-7K3Q-9XZT')
  assert.equal(normalizeCode('pr-7k3q-9xzt'), '7K3Q9XZT')
  assert.equal(normalizeCode(' 7K3Q 9XZT '), '7K3Q9XZT')
  assert.equal(normalizeCode('PR-OIL0-0000'), '01100000')
  assert.equal(normalizeCode('PR-7K3Q-9XZ'), null)
  assert.equal(normalizeCode('PR-7K3Q-9XZU'), null)
  assert.equal(normalizeCode(42), null)
})

test('names are trimmed, stripped of control characters and capped', () => {
  assert.equal(normalizeName('  night\u0000  owl‮ '), 'night owl')
  assert.equal(normalizeName('x'.repeat(40)).length, 24)
  assert.equal(normalizeName('   '), null)
  assert.equal(normalizeName(null), null)
})

test('client frames are validated and sanitised', () => {
  assert.equal(parseClientMessage('not json'), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'hello', token: 'short' })), null)
  assert.equal(parseClientMessage(JSON.stringify({ type: 'nope' })), null)
  assert.equal(parseClientMessage('x'.repeat(5000)), null)
  const presence = parseClientMessage(JSON.stringify({
    type: 'presence',
    presence: {
      station: { id: 'abc-123', name: '  Jazz   FM ', url: 'https://evil.test/stream', location: 'Paris', country: 'fr', lat: 48.8, lon: 999, curated: 'yes' },
      focus: { phase: 'focus', remainingMs: 1e12, paused: 1 },
    },
  }))
  assert.deepEqual(presence.presence.station, { id: 'abc-123', name: 'Jazz FM', location: 'Paris', country: 'FR', lat: null, lon: null, curated: false })
  assert.equal('url' in presence.presence.station, false, 'stream URLs never travel')
  assert.deepEqual(presence.presence.focus, { phase: 'focus', remainingMs: 6 * 3600_000, paused: false })
  assert.deepEqual(parseClientMessage(JSON.stringify({ type: 'presence', presence: { station: { id: 'bad id!' }, focus: { phase: 'nap' } } })).presence, { station: null, focus: null })
})

test('server frames are re-validated by the client', () => {
  const welcome = parseServerMessage(JSON.stringify({
    type: 'welcome',
    self: { userId: 'u1', name: 'Ada', code: '7K3Q9XZT' },
    friends: [
      { userId: 'u2', name: 'Bob', code: '7K3Q9XZA', online: true, presence: { station: null, focus: null } },
      { userId: 'bad id', name: 'Eve', code: 'nope', online: true },
      { userId: 'u3', name: 'Cy', code: '7K3Q9XZB', online: false, presence: { station: { id: 's', name: 'S' } } },
    ],
  }))
  assert.deepEqual(welcome.friends.map((f) => f.userId), ['u2', 'u3'])
  assert.equal(welcome.friends[1].presence, null, 'offline friends carry no presence')
  assert.equal(parseServerMessage(JSON.stringify({ type: 'error', reason: 'weird', message: 'x' })).reason, 'invalid')
})

test('friend status text counts down from when the update arrived', () => {
  const friend = (presence, online = true) => ({ userId: 'u', name: 'Bob', code: '7K3Q9XZA', online, presence })
  const station = { id: 's', name: 'Jazz FM', location: '', country: '', lat: null, lon: null, curated: false }
  assert.equal(friendStatus(friend(null, false), 0, 0), 'offline')
  assert.equal(friendStatus(friend({ station: null, focus: null }), 0, 0), 'online')
  assert.equal(friendStatus(friend({ station, focus: { phase: 'focus', remainingMs: 20 * 60_000, paused: false } }), 0, 2 * 60_000), 'Focusing · 18m left · ♪ Jazz FM')
  assert.equal(friendStatus(friend({ station: null, focus: { phase: 'break', remainingMs: 3 * 60_000, paused: true } }), 0, 10 * 60_000), 'Break paused')
  assert.equal(friendStatus(friend({ station: null, focus: { phase: 'focus', remainingMs: 25 * 60_000 - 5, paused: false } }), 5000, 0), 'Focusing · 25m left')
})

test('the configured server address is reduced to its origin', () => {
  assert.equal(presenceOrigin(' https://pixel-radio-presence.me.workers.dev/ '), 'https://pixel-radio-presence.me.workers.dev')
  assert.equal(presenceOrigin('https://pixel-radio-presence.me.workers.dev/api/health'), 'https://pixel-radio-presence.me.workers.dev')
  assert.equal(presenceOrigin('pixel-radio-presence.me.workers.dev'), 'https://pixel-radio-presence.me.workers.dev')
  assert.equal(presenceOrigin('http://127.0.0.1:8787/api'), 'http://127.0.0.1:8787')
  assert.equal(presenceOrigin(''), '')
  assert.equal(presenceOrigin('ftp://example.com'), '')
})
