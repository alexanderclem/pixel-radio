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

const failing = (...ids) => async (s) => {
  if (ids.includes(s.id)) throw new Error('no answer')
  return true
}

test('a requested station that does not answer is explained, with the stand-in named', async (t) => {
  const { controller, state } = setup(t, { engine: { playStation: failing('wanted') } })
  await controller.powerOn()
  await flush()
  const wanted = station('wanted', { lat: 47.6, lon: -122.3 })
  state().requestStation(wanted, false)
  await flush()
  assert.notEqual(state().station.id, 'wanted')
  assert.deepEqual(state().fallback, { wanted: 'wanted', wantedStation: wanted, reason: 'no-answer' })

  // Asking for something that works clears the notice
  state().requestStation(station('fine'), false)
  await flush()
  assert.equal(state().station.id, 'fine')
  assert.equal(state().fallback, null)
})

test('when nothing answers the notice says so', async (t) => {
  const { controller, state } = setup(t, { engine: { playStation: async () => { throw new Error('down') } } })
  await controller.powerOn()
  await flush()
  assert.equal(state().tuneStatus, 'error')
  assert.equal(state().fallback.reason, 'failed')
  assert.equal(state().fallback.wanted, 'stations in Tokyo')
})

test('a city whose directory lookup fails says the directory is down', async (t) => {
  const { controller, state } = setup(t, { findCity: async () => { throw new Error('offline') } })
  await controller.powerOn()
  await flush()
  assert.equal(state().station.source, 'curated')
  assert.equal(state().fallback.reason, 'directory')
})

test('a stand-in requested for a mood is explained as a directory fallback', async (t) => {
  const { controller, state } = setup(t)
  await controller.powerOn({ tune: false })
  assert.equal(state().powered, true)
  assert.equal(state().tuneStatus, 'tuning', 'powered on, waiting for the mood to pick')
  state().requestStation(station('rp-mellow', { source: 'curated' }), false, 'a popular station near tokyo')
  await flush()
  assert.equal(state().station.id, 'rp-mellow')
  assert.equal(state().fallback.reason, 'directory')
})

test('a repeated drop says which station dropped out', async (t) => {
  const { engine, controller, state } = setup(t)
  await controller.powerOn()
  await flush()
  const first = state().station
  engine.onStreamEvent({ type: 'error', station: first, error: new Error('lost') })
  await flush()
  assert.equal(state().fallback, null, 'the first drop just reconnects')
  engine.onStreamEvent({ type: 'error', station: state().station, error: new Error('lost again') })
  await flush()
  assert.equal(state().fallback.reason, 'dropped')
  assert.equal(state().fallback.wanted, first.name)
})

test('audio that never starts (no click yet) gives up, and the next power-on starts fresh', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const never = deferred()
  let inits = 0
  const { controller, engine, state } = setup(t, { engine: { init: () => { inits++; return never.promise } } })
  const first = controller.powerOn()
  const rejected = assert.rejects(first, { name: 'AudioNeedsClick' })
  t.mock.timers.tick(6000)
  await rejected
  assert.equal(state().powered, false)
  engine.init = async () => { inits++ }
  const second = controller.powerOn()
  assert.notEqual(second, first, 'a new attempt, not the stuck one')
  await second
  assert.equal(state().powered, true)
  assert.equal(inits, 2)
  // The stale attempt finishing late changes nothing
  never.resolve()
  await flush()
  assert.equal(state().powered, true)
})

test('pause stops only the radio and keeps the station on the display; play reconnects it', async (t) => {
  const stops = []
  const { controller, engine, calls, state } = setup(t, { engine: { stopStream: () => stops.push('stop') } })
  await controller.powerOn()
  await flush()
  const playing = state().station
  controller.pause()
  assert.equal(state().tuneStatus, 'paused')
  assert.equal(state().powered, true, 'ambience, mood and timer carry on')
  assert.equal(state().station.id, playing.id)
  assert.ok(stops.length > 0)
  // A late event from the stopped stream must not start a recovery
  engine.onStreamEvent({ type: 'error', station: playing, error: new Error('closed') })
  await flush()
  assert.equal(state().tuneStatus, 'paused')
  const before = calls.length
  controller.resume()
  await flush()
  assert.equal(state().tuneStatus, 'playing')
  assert.equal(calls.length, before + 1)
  assert.equal(calls.at(-1).station.id, playing.id)
})

test('picking another station while paused just tunes it, and only one stream wins a quick switch', async (t) => {
  const slow = deferred()
  const { controller, state } = setup(t, {
    engine: { playStation: async (s) => { if (s.id === 'slow') await slow.promise; return true } },
  })
  await controller.powerOn()
  await flush()
  controller.pause()
  state().requestStation(station('slow'), false)
  await flush()
  assert.equal(state().tuneStatus, 'tuning')
  state().requestStation(station('fast'), false)
  await flush()
  slow.resolve()
  await flush()
  assert.equal(state().station.id, 'fast', 'the stale attempt never takes over')
  assert.equal(state().tuneStatus, 'playing')
})
