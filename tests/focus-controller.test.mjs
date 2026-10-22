import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { FocusController, focusRemaining, isPaused } from '../src/focus/FocusController.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'

const MIN = 60_000
const state = () => useRadioStore.getState()
beforeEach(() => useRadioStore.setState(useRadioStore.getInitialState(), true))

function setup(t) {
  const clock = { now: Date.UTC(2026, 9, 22, 12) }
  const calls = []
  const engine = { chime: (high) => calls.push(['chime', high]), setDuck: (level) => calls.push(['duck', level]) }
  const controller = new FocusController(engine, () => clock.now)
  const disconnect = controller.connect()
  t.after(disconnect)
  const advance = (ms) => {
    clock.now += ms
    controller.tick()
  }
  return { controller, calls, clock, advance }
}

test('a focus session runs into a short break, then waits for the next start', (t) => {
  const { controller, calls, advance } = setup(t)
  controller.start()
  assert.equal(state().focus.phase, 'focus')
  advance(24 * MIN)
  assert.equal(state().focus.phase, 'focus')
  advance(1 * MIN)
  assert.equal(state().focus.phase, 'break')
  assert.equal(state().focus.longBreak, false)
  assert.equal(state().focus.completed, 1)
  assert.deepEqual(calls.filter(([k]) => k === 'chime'), [['chime', false]])
  const lastDuck = () => calls.filter(([k]) => k === 'duck').at(-1)
  assert.deepEqual(lastDuck(), ['duck', 0.35])
  advance(5 * MIN)
  assert.equal(state().focus.phase, 'idle')
  assert.deepEqual(lastDuck(), ['duck', 1])
  assert.deepEqual(calls.filter(([k]) => k === 'chime').at(-1), ['chime', true])
})

test('every fourth completed session earns a long break', (t) => {
  const { controller, advance } = setup(t)
  for (let i = 1; i <= 4; i++) {
    controller.start()
    advance(25 * MIN)
    assert.equal(state().focus.longBreak, i === 4, `session ${i}`)
    controller.skip()
  }
  assert.equal(state().focus.completed, 4)
})

test('pause freezes the remaining time and resume continues from it', (t) => {
  const { controller, clock, advance } = setup(t)
  controller.start()
  advance(10 * MIN)
  controller.pause()
  assert.ok(isPaused(state().focus))
  advance(60 * MIN)
  assert.equal(state().focus.phase, 'focus')
  assert.equal(focusRemaining(state().focus, clock.now), 15 * MIN)
  controller.toggle()
  assert.equal(focusRemaining(state().focus, clock.now), 15 * MIN)
  advance(15 * MIN)
  assert.equal(state().focus.phase, 'break')
})

test('a long stall (throttled tab) still lands on the right phase', (t) => {
  const { controller, advance } = setup(t)
  controller.start()
  advance(40 * MIN)
  assert.equal(state().focus.phase, 'break')
})

test('skipping a focus session does not count it; reset returns to idle without chiming', (t) => {
  const { controller, calls } = setup(t)
  controller.start()
  controller.skip()
  assert.equal(state().focus.phase, 'break')
  assert.equal(state().focus.completed, 0)
  const chimes = calls.filter(([k]) => k === 'chime').length
  controller.reset()
  assert.equal(state().focus.phase, 'idle')
  assert.equal(calls.filter(([k]) => k === 'chime').length, chimes)
})

test('chime and ducking follow their settings', (t) => {
  const { controller, calls, advance } = setup(t)
  state().setFocusSettings({ chime: false, duckOnBreak: false })
  controller.start()
  advance(25 * MIN)
  assert.equal(state().focus.phase, 'break')
  assert.equal(calls.filter(([k]) => k === 'chime').length, 0)
  assert.ok(calls.filter(([k]) => k === 'duck').every(([, level]) => level === 1))
  state().setFocusSettings({ duckOnBreak: true })
  assert.deepEqual(calls.at(-1), ['duck', 0.35])
})

test('focus mode toggles and closes the drawer', (t) => {
  const { controller } = setup(t)
  state().setDrawer('favorites')
  controller.toggleMode()
  assert.equal(state().focus.mode, true)
  assert.equal(state().drawer, null)
  controller.toggleMode()
  assert.equal(state().focus.mode, false)
})
