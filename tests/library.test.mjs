import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { isCalm, localDay, MAX_RECENTS, useRadioStore } from '../src/store/useRadioStore.ts'
import { station } from './helpers.mjs'

const state = () => useRadioStore.getState()
beforeEach(() => {
  delete globalThis.localStorage
  useRadioStore.setState(useRadioStore.getInitialState(), true)
})

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  }
}

test('store works without localStorage', () => {
  state().setAudio({ master: 0.3 })
  assert.equal(state().audio.master, 0.3)
})

test('recents de-duplicate, newest first, and are capped', () => {
  for (let i = 0; i < MAX_RECENTS + 3; i++) state().pushRecent(station(`s${i}`))
  state().pushRecent(station('s5'))
  const ids = state().library.recents.map((s) => s.id)
  assert.equal(ids.length, MAX_RECENTS)
  assert.equal(ids[0], 's5')
  assert.equal(ids.filter((id) => id === 's5').length, 1)
  state().removeRecent('s5')
  assert.ok(!state().library.recents.some((s) => s.id === 's5'))
})

test('favorites toggle on and off', () => {
  state().toggleFavorite(station('a'))
  state().toggleFavorite(station('b'))
  assert.deepEqual(state().library.favorites.map((s) => s.id), ['b', 'a'])
  state().toggleFavorite(station('a'))
  assert.deepEqual(state().library.favorites.map((s) => s.id), ['b'])
})

test('focus mode implies calm', () => {
  state().setFx({ calm: false })
  assert.equal(isCalm(state()), false)
  state().setFocus({ mode: true })
  assert.equal(isCalm(state()), true)
})

test('settings persist and session state does not', () => {
  globalThis.localStorage = fakeStorage()
  state().setAudio({ hiss: 0.42 })
  state().setFx({ calm: true })
  state().toggleFavorite(station('fav'))
  state().setPowered(true)
  state().setFocus({ phase: 'focus', endsAt: 123 })
  const saved = JSON.parse(globalThis.localStorage.getItem('pixel-radio.v1')).state
  assert.equal(saved.audio.hiss, 0.42)
  assert.equal(saved.fx.calm, true)
  assert.equal(saved.library.favorites[0].id, 'fav')
  assert.equal(saved.powered, undefined)
  assert.equal(saved.focus.phase, undefined)
  assert.equal(saved.focus.endsAt, undefined)
})

test('rehydrate merges saved values over defaults and ignores garbage', async () => {
  globalThis.localStorage = fakeStorage({
    'pixel-radio.v1': JSON.stringify({
      version: 1,
      state: {
        audio: { master: 0.25, stream: 'loud' },
        crt: { scanlines: false },
        weather: { mode: 'tornado', density: 0.9 },
        solarOverride: 'eclipse',
        library: { favorites: [station('x'), { nope: true }], recents: 'bad' },
        focus: { settings: { work: 50, chime: 'yes' }, completed: 3, completedDay: '2000-01-01' },
      },
    }),
  })
  await useRadioStore.persist.rehydrate()
  const s = state()
  assert.equal(s.audio.master, 0.25)
  assert.equal(s.audio.stream, 0.8)
  assert.equal(s.crt.scanlines, false)
  assert.equal(s.crt.enabled, true)
  assert.equal(s.weather.mode, 'auto')
  assert.equal(s.weather.density, 0.9)
  assert.equal(s.solarOverride, 'auto')
  assert.deepEqual(s.library.favorites.map((f) => f.id), ['x'])
  assert.deepEqual(s.library.recents, [])
  assert.equal(s.focus.settings.work, 50)
  assert.equal(s.focus.settings.chime, true)
  // Yesterday's count resets
  assert.equal(s.focus.completed, 0)
  assert.equal(s.focus.completedDay, localDay())
  assert.equal(s.focus.phase, 'idle')
})
