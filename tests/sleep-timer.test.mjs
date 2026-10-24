import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { SleepController, sleepRemaining } from '../src/sleep/SleepController.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { flush } from './helpers.mjs'

const MIN = 60_000
const state = () => useRadioStore.getState()
beforeEach(() => useRadioStore.setState({ ...useRadioStore.getInitialState(), powered: true }, true))

function setup(t) {
  const clock = { now: Date.UTC(2026, 9, 23, 22) }
  const fades = []
  let offs = 0
  const engine = { setFade: (level) => fades.push(level) }
  const powerOff = () => {
    offs++
    useRadioStore.setState({ powered: false })
  }
  const controller = new SleepController(engine, powerOff, () => clock.now)
  const disconnect = controller.connect()
  t.after(disconnect)
  const advance = (ms) => {
    clock.now += ms
    controller.tick()
  }
  return { controller, fades, advance, clock, offs: () => offs }
}

test('a timer holds full volume, fades over its last stretch, then powers off', async (t) => {
  const { controller, fades, advance, offs } = setup(t)
  controller.start(30)
  assert.equal(state().sleep.mode, 'timer')
  assert.equal(sleepRemaining(state().sleep, Date.UTC(2026, 9, 23, 22)), 30 * MIN)
  assert.equal(state().sleep.fadeMs, 5 * MIN, 'long timers fade over five minutes')
  advance(24 * MIN)
  assert.deepEqual(fades, [], 'no fade before the last five minutes')
  advance(3.5 * MIN)
  const mid = fades.at(-1)
  assert.ok(mid > 0.2 && mid < 0.4, `half way through the fade is quieter (${mid})`)
  advance(2 * MIN)
  assert.ok(fades.at(-1) < mid)
  assert.equal(offs(), 0)
  advance(1 * MIN)
  assert.equal(offs(), 1)
  assert.equal(state().sleep.mode, 'off')
  await flush()
  assert.equal(fades.at(-1), 1, 'ready at full volume for the next power-on')
  assert.equal(state().audio.master, useRadioStore.getInitialState().audio.master, 'the saved volume never moved')
})

test('short timers fade over their last third', (t) => {
  const { controller } = setup(t)
  controller.start(15)
  assert.equal(state().sleep.fadeMs, 5 * MIN)
  controller.start(6)
  assert.equal(state().sleep.fadeMs, 2 * MIN)
})

test('turning the volume during the fade, or powering off, cancels the timer', (t) => {
  const { controller, fades, advance } = setup(t)
  controller.start(15)
  state().setAudio({ master: 0.5 })
  assert.equal(state().sleep.mode, 'timer', 'outside the fade, a volume change is just a volume change')
  advance(13 * MIN)
  assert.ok(fades.at(-1) < 1)
  state().setAudio({ master: 0.6 })
  assert.equal(state().sleep.mode, 'off')
  assert.equal(fades.at(-1), 1)
  assert.match(state().toast.text, /volume/)

  controller.start(15)
  useRadioStore.setState({ powered: false })
  assert.equal(state().sleep.mode, 'off')
})

test('end of focus session: waits for a finished session, then fades for 30 seconds', async (t) => {
  const { controller, advance, offs } = setup(t)
  controller.atFocusEnd()
  assert.equal(sleepRemaining(state().sleep), null, 'nothing counts down yet')
  state().setFocus({ phase: 'focus' })
  // Skipping a session isn't finishing it
  state().setFocus({ phase: 'break' })
  assert.equal(state().sleep.endsAt, null)
  state().setFocus({ phase: 'focus' })
  // Stopping isn't finishing either
  state().setFocus({ phase: 'idle' })
  assert.equal(state().sleep.endsAt, null)
  state().setFocus({ phase: 'focus' })
  state().setFocus({ phase: 'break', completed: state().focus.completed + 1 })
  assert.ok(state().sleep.endsAt !== null)
  assert.match(state().toast.text, /30 s/)
  advance(31_000)
  assert.equal(offs(), 1)
})

test('in a study room the phase change alone ends the session', (t) => {
  const { controller } = setup(t)
  useRadioStore.setState({ room: { study: true } })
  controller.atFocusEnd()
  state().setFocus({ phase: 'focus' })
  state().setFocus({ phase: 'break' })
  assert.ok(state().sleep.endsAt !== null)
})
