import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { station } from './helpers.mjs'
import { ATMOSPHERE_BY_ID } from '../src/session/atmospheres.ts'

const state = () => useRadioStore.getState()
beforeEach(() => {
  delete globalThis.localStorage
  useRadioStore.setState(useRadioStore.getInitialState(), true)
})

const storageWith = (value) => {
  const data = new Map(value === undefined ? [] : [['pixel-radio.v1', value]])
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) }
}

test('a returning visit restores the setup without starting audio or a focus session', async () => {
  const saved = {
    state: {
      audio: { ...state().audio, master: 0.35, stream: 0.6 },
      focus: { settings: { ...state().focus.settings, work: 50, short: 10 }, completed: 0, completedDay: '2000-01-01' },
      lastSession: { station: station('kept'), ...ATMOSPHERE_BY_ID['rainy-tokyo'].settings, atmosphereId: 'rainy-tokyo', savedAt: 1 },
      atmosphere: { id: 'rainy-tokyo', name: 'Rainy Tokyo' },
      library: { favorites: [station('fav')], recents: [], tracks: [], setups: [], moods: [] },
    },
    version: 1,
  }
  globalThis.localStorage = storageWith(JSON.stringify(saved))
  await useRadioStore.persist.rehydrate()
  assert.equal(state().audio.master, 0.35)
  assert.equal(state().focus.settings.work, 50)
  assert.equal(state().focus.phase, 'idle', 'the timer waits for Start')
  assert.equal(state().powered, false, 'audio waits for a click')
  assert.equal(state().lastSession.station.id, 'kept', 'Resume offers the last station')
  assert.equal(state().library.favorites[0].id, 'fav')
})

test('corrupt saved settings fall back to safe defaults', async () => {
  globalThis.localStorage = storageWith('{not json')
  await useRadioStore.persist.rehydrate()
  assert.equal(state().audio.master, useRadioStore.getInitialState().audio.master)
  globalThis.localStorage = storageWith(JSON.stringify({ state: { audio: 'loud', focus: { settings: { work: 'long' } }, lastSession: { station: 42 }, schedules: 'x' }, version: 1 }))
  await useRadioStore.persist.rehydrate()
  assert.equal(typeof state().audio.master, 'number')
  assert.equal(state().focus.settings.work, useRadioStore.getInitialState().focus.settings.work)
  assert.equal(state().lastSession, null)
  assert.deepEqual(state().schedules, [])
})

test('storage that throws (blocked site data) never breaks the app', async () => {
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
  globalThis.localStorage = blocked
  await useRadioStore.persist.rehydrate()
  state().setAudio({ master: 0.2 })
  assert.equal(state().audio.master, 0.2)
})
