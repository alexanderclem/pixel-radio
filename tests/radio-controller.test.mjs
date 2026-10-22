import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { RadioController } from '../src/audio/RadioController.ts'
import { PlaybackBlocked } from '../src/audio/StreamPlayer.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { deferred, flush, station } from './helpers.mjs'

beforeEach(() => useRadioStore.setState(useRadioStore.getInitialState(), true))
function setup(t, options = {}) {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [] }))
  const calls = []
  const engine = {
    ready: true, onStreamEvent: null, init: async () => {}, suspend: async () => {},
    setParams() {}, setMood() {}, stopStream() {}, startTuning() {}, stopTuning() {},
    playStation: async (station, timeout) => { calls.push({ station, timeout }); return true },
    ...options.engine,
  }
  const findCity = options.findCity ?? (async () => [station('one'), station('two')])
  const controller = new RadioController(engine, findCity)
  const disconnect = controller.connect()
  t.after(disconnect)
  const state = () => useRadioStore.getState()
  return { engine, controller, calls, state }
}

test('disconnect retries current station, repeated drops try another, then stop at the recovery limit', async (t) => {
  const { engine, controller, calls, state } = setup(t)
  await controller.powerOn()
  await flush()
  assert.equal(state().station.id, 'one')
  engine.onStreamEvent({ type: 'error', station: state().station, error: new Error('lost') })
  await flush()
  assert.deepEqual(calls.map((call) => call.station.id), ['one', 'one'])
  engine.onStreamEvent({ type: 'error', station: state().station, error: new Error('lost again') })
  await flush()
  assert.equal(state().station.id, 'two')
  engine.onStreamEvent({ type: 'error', station: state().station, error: new Error('lost third time') })
  await flush()
  assert.equal(state().station, null)
  assert.equal(state().tuneStatus, 'error')
  assert.equal(state().statusText, 'SIGNAL LOST · RETRY')
  state().retryTune()
  await flush()
  assert.equal(state().station.id, 'one')
  assert.equal(state().tuneStatus, 'playing')
})

test('buffering immediately replaces LIVE and resumed playback restores it', async (t) => {
  const { engine, controller, state } = setup(t)
  await controller.powerOn()
  await flush()
  const current = state().station
  engine.onStreamEvent({ type: 'buffering', station: current })
  assert.equal(state().statusText, 'BUFFERING…')
  assert.equal(state().tuneStatus, 'tuning')
  engine.onStreamEvent({ type: 'playing', station: current })
  assert.equal(state().statusText, 'LIVE')
  assert.equal(state().tuneStatus, 'playing')
})

test('switching cities aborts previous lookup and ignores late results', async (t) => {
  const old = deferred()
  let firstSignal
  const { controller, state } = setup(t, { findCity: async (city, signal) => {
    if (city.id === 'tokyo') { firstSignal = signal; return old.promise }
    return [station('new-city')]
  } })
  await controller.powerOn()
  state().selectCity('london')
  await flush()
  assert.equal(firstSignal.aborted, true)
  assert.equal(state().station.id, 'new-city')
  old.resolve([station('old-city')])
  await flush()
  assert.equal(state().station.id, 'new-city')
})

test('power-off blocks controls immediately and late stream completion cannot restore LIVE', async (t) => {
  const play = deferred()
  const suspend = deferred()
  const { controller, state } = setup(t, { engine: {
    playStation: () => play.promise,
    suspend: () => suspend.promise,
  } })
  await controller.powerOn()
  await flush()
  const off = controller.powerOff()
  assert.equal(state().powered, false)
  state().requestStation(station('ignored'), true)
  play.resolve(true)
  await flush()
  assert.equal(state().tuneStatus, 'idle')
  assert.equal(state().station, null)
  suspend.resolve()
  await off
})

test('power-off during pending startup prevents a stale startup from powering on', async (t) => {
  const init = deferred()
  const { controller, state } = setup(t, { engine: { init: () => init.promise } })
  const on = controller.powerOn()
  assert.equal(controller.powerOn(), on)
  await controller.powerOff()
  init.resolve()
  await on
  assert.equal(state().powered, false)
  assert.equal(state().station, null)
})

test('directory outage still tunes a curated stream and labels the fallback', async (t) => {
  const { controller, state } = setup(t, { findCity: async () => { throw new Error('offline') } })
  await controller.powerOn()
  await flush()
  assert.equal(state().station.source, 'curated')
  assert.equal(state().statusText, 'LIVE · FALLBACK')
})

test('tuning budgets preserve time for fallbacks and reach a retryable error', async (t) => {
  let now = 0
  t.mock.method(performance, 'now', () => now)
  const attempts = []
  const { controller, state } = setup(t, {
    findCity: async () => [station('one'), station('two'), station('three')],
    engine: { playStation: async (station, timeout) => {
      attempts.push({ source: station.source, timeout })
      now += timeout
      throw new Error('timed out')
    } },
  })
  await controller.powerOn()
  await flush()
  assert.deepEqual(attempts, [
    { source: 'radio-browser', timeout: 6000 }, { source: 'radio-browser', timeout: 6000 },
    { source: 'curated', timeout: 6000 }, { source: 'curated', timeout: 3000 },
  ])
  assert.equal(now, 21000)
  assert.equal(state().tuneStatus, 'error')
})

test('autoplay block stops candidate cycling and retry resumes the exact blocked station', async (t) => {
  let allow = false
  const attempts = []
  const { controller, state } = setup(t, { engine: { playStation: async (station) => {
    attempts.push(station.id)
    if (!allow) throw new PlaybackBlocked()
    return true
  } } })
  await controller.powerOn()
  await flush()
  assert.deepEqual(attempts, ['one'])
  assert.equal(state().statusText, 'PRESS RETRY TO PLAY')
  allow = true
  state().retryTune()
  await flush()
  assert.deepEqual(attempts, ['one', 'one'])
  assert.equal(state().tuneStatus, 'playing')
})

test('reselecting the same city retunes it after a failure', async (t) => {
  let fail = true
  const { controller, state } = setup(t, { engine: { playStation: async () => {
    if (fail) throw new Error('offline')
    return true
  } } })
  await controller.powerOn()
  await flush()
  assert.equal(state().tuneStatus, 'error')
  fail = false
  state().selectCity('tokyo')
  await flush()
  assert.equal(state().tuneStatus, 'playing')
})

test('a pending retry cannot override a newer city selection when audio resume fails', async (t) => {
  const pending = deferred()
  const { controller, engine, state } = setup(t, { findCity: async (city) => [station(city.id)] })
  await controller.powerOn()
  await flush()
  engine.init = () => pending.promise
  state().retryTune()
  state().selectCity('london')
  await flush()
  pending.reject(new Error('old resume failed'))
  await flush()
  assert.equal(state().station.id, 'london')
  assert.equal(state().tuneStatus, 'playing')
})

test('power-on from a shared link plays that station instead of the last city', async (t) => {
  const { controller, calls, state } = setup(t)
  const shared = station('shared', { lat: 47.6, lon: -122.3 })
  state().setLaunch(shared)
  await controller.powerOn()
  await flush()
  assert.equal(calls[0].station.id, 'shared')
  assert.equal(state().station.id, 'shared')
  assert.equal(state().launch, null)
  assert.equal(state().selectedCityId, null)
  assert.equal(state().stationRequest.fly, true, 'the map flies to it')
})
