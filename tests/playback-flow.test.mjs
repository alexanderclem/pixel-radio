import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RadioController } from '../src/audio/RadioController.ts'
import { StreamPlayer } from '../src/audio/StreamPlayer.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { FakeAudio, fakeContext, flush, station } from './helpers.mjs'

test('controller and real stream player recover together, stop retry loops, and power off cleanly', async (t) => {
  useRadioStore.setState(useRadioStore.getInitialState(), true)
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [] }))
  globalThis.Audio = FakeAudio
  FakeAudio.instances = []
  FakeAudio.behavior = async (audio) => audio.emit('playing')
  const player = new StreamPlayer(fakeContext(), 10)
  const engine = {
    ready: true, onStreamEvent: null, init: async () => {}, suspend: async () => player.stop(),
    setParams() {}, setMood() {}, startTuning() {}, stopTuning() {},
    stopStream: () => player.stop(),
    playStation: (station, timeout) => player.play(station, timeout),
  }
  player.onEvent = (event) => engine.onStreamEvent?.(event)
  const controller = new RadioController(engine, async () => [station('one'), station('two')])
  const disconnect = controller.connect()
  t.after(disconnect)
  const state = () => useRadioStore.getState()
  await controller.powerOn()
  await flush()
  assert.equal(state().station.id, 'one')
  FakeAudio.instances[0].emit('error')
  await flush()
  assert.equal(state().station.id, 'one')
  const retryAudio = FakeAudio.instances.at(-1)
  retryAudio.emit('waiting')
  assert.equal(state().statusText, 'BUFFERING…')
  await new Promise((resolve) => setTimeout(resolve, 20))
  await flush()
  assert.equal(state().station.id, 'two')
  FakeAudio.instances.at(-1).emit('ended')
  await flush()
  assert.equal(state().tuneStatus, 'error')
  state().retryTune()
  await flush()
  assert.equal(state().station.id, 'one')
  const current = FakeAudio.instances.at(-1)
  await controller.powerOff()
  current.emit('playing')
  retryAudio.emit('error')
  await flush()
  assert.equal(state().powered, false)
  assert.equal(state().station, null)
  assert.equal(state().tuneStatus, 'idle')
  assert.equal(current.paused, true)
})
