import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { StreamPlayer, StreamCancelled, PlaybackBlocked } from '../src/audio/StreamPlayer.ts'
import Hls from './fixtures/Hls.mjs'
import { FakeAudio, fakeContext, flush, station } from './helpers.mjs'

beforeEach(() => {
  globalThis.Audio = FakeAudio
  FakeAudio.instances = []
  Hls.instances = []
  FakeAudio.behavior = async (audio) => { audio.emit('playing') }
})

test('reports disconnect after playback starts, then removes listeners and stops audio', async () => {
  const player = new StreamPlayer(fakeContext())
  const events = []
  player.onEvent = (event) => events.push(event.type)
  assert.equal(await player.play(station('one'), 100), true)
  const audio = FakeAudio.instances[0]
  audio.emit('error')
  audio.emit('error')
  assert.deepEqual(events, ['playing', 'error'])
  assert.equal(audio.paused, true)
  assert.equal([...audio.listeners.values()].reduce((n, listeners) => n + listeners.size, 0), 0)
})

test('a transient stall resumes without reconnecting; a persistent stall fails once', async () => {
  const player = new StreamPlayer(fakeContext(), 15)
  const events = []
  player.onEvent = (event) => events.push(event.type)
  await player.play(station('one'), 100)
  const audio = FakeAudio.instances[0]
  audio.emit('waiting')
  audio.currentTime = 1
  audio.emit('timeupdate')
  assert.deepEqual(events, ['playing', 'buffering', 'playing'])
  audio.emit('stalled')
  audio.emit('waiting')
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.deepEqual(events, ['playing', 'buffering', 'playing', 'buffering', 'error'])
  player.stop()
})

test('stop cancels an unresolved play immediately and late media events stay silent', async () => {
  const player = new StreamPlayer(fakeContext())
  FakeAudio.behavior = () => new Promise(() => {})
  const pending = player.play(station('one'), 10000)
  const cancelled = assert.rejects(pending, StreamCancelled)
  const audio = FakeAudio.instances[0]
  player.stop()
  await cancelled
  const events = []
  player.onEvent = (event) => events.push(event.type)
  audio.emit('playing')
  audio.emit('error')
  assert.deepEqual(events, [])
})

test('superseding a pending station never tears down the new stream', async () => {
  const player = new StreamPlayer(fakeContext())
  FakeAudio.behavior = (audio) => audio.src.endsWith('/one') ? new Promise(() => {}) : Promise.resolve(audio.emit('playing'))
  const first = assert.rejects(player.play(station('one'), 1000), StreamCancelled)
  assert.equal(await player.play(station('two'), 1000), true)
  await first
  const audio = FakeAudio.instances[1]
  assert.notEqual(audio.paused, true)
  player.stop()
})

test('CORS fallback starts at the configured direct volume, including mute', async () => {
  const player = new StreamPlayer(fakeContext())
  player.setDirectVolume(0)
  FakeAudio.behavior = async (audio) => {
    if (audio.crossOrigin) audio.emit('error')
    else { assert.equal(audio.volume, 0); audio.emit('playing') }
  }
  assert.equal(await player.play(station('direct'), 100), false)
  player.setDirectVolume(0.2)
  assert.equal(FakeAudio.instances[1].volume, 0.2)
  player.stop()
})

test('autoplay rejection is surfaced without cycling through CORS retries', async () => {
  const player = new StreamPlayer(fakeContext())
  FakeAudio.behavior = async () => { throw new DOMException('gesture required', 'NotAllowedError') }
  await assert.rejects(player.play(station('blocked'), 100), PlaybackBlocked)
  assert.equal(FakeAudio.instances.length, 1)
})

test('HLS fatal errors remain observable after initial playback', async () => {
  const player = new StreamPlayer(fakeContext())
  const events = []
  player.onEvent = (event) => events.push(event.type)
  await player.play(station('hls', { hls: true }), 1000)
  Hls.instances[0].fatal()
  assert.deepEqual(events, ['playing', 'error'])
  assert.equal(Hls.instances[0].destroyed, true)
})

test('ended live streams trigger recovery, but intentional teardown never does', async () => {
  const player = new StreamPlayer(fakeContext())
  const events = []
  player.onEvent = (event) => events.push(event.type)
  await player.play(station('one'), 100)
  FakeAudio.instances[0].emit('ended')
  await player.play(station('two'), 100)
  player.stop()
  FakeAudio.instances[1].emit('ended')
  await flush()
  assert.deepEqual(events, ['playing', 'error', 'playing'])
})

test('a stream that disconnects during startup is never reported as successfully locked', async () => {
  const player = new StreamPlayer(fakeContext())
  FakeAudio.behavior = async (audio) => { audio.emit('playing'); audio.emit('error') }
  await assert.rejects(player.play(station('flapping'), 100), /disconnected during startup/)
  player.stop()
})

test('cancellation during asynchronous HLS loading never attaches a stale player', async () => {
  const player = new StreamPlayer(fakeContext())
  const pending = assert.rejects(player.play(station('hls', { hls: true }), 1000), StreamCancelled)
  player.stop()
  await pending
  await flush()
  assert.equal(Hls.instances.length, 0)
  assert.equal(FakeAudio.instances[0].paused, true)
})
