import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ScheduleController, dueSchedules, daysLabel } from '../src/sleep/schedules.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'

const state = () => useRadioStore.getState()
beforeEach(() => useRadioStore.setState(useRadioStore.getInitialState(), true))

// Friday 23 October 2026, local time
const at = (h, m, day = 23) => new Date(2026, 9, day, h, m)
const schedule = (patch = {}) => ({ id: 's1', moodId: 'morning-jazz', time: '07:30', days: [], enabled: true, lastFired: null, ...patch })

test('due on its day, from its time until half an hour later, once a day', () => {
  assert.deepEqual(dueSchedules([schedule()], at(7, 29)), [])
  assert.equal(dueSchedules([schedule()], at(7, 30)).length, 1)
  assert.equal(dueSchedules([schedule()], at(7, 59)).length, 1)
  assert.deepEqual(dueSchedules([schedule()], at(8, 0)), [], 'opening the app hours later does not blast a morning mood')
  assert.deepEqual(dueSchedules([schedule({ lastFired: '2026-10-23' })], at(7, 31)), [])
  assert.deepEqual(dueSchedules([schedule({ enabled: false })], at(7, 31)), [])
  assert.equal(dueSchedules([schedule({ days: [5] })], at(7, 31)).length, 1, 'Friday')
  assert.deepEqual(dueSchedules([schedule({ days: [0, 6] })], at(7, 31)), [])
})

test('day labels', () => {
  assert.equal(daysLabel([]), 'Every day')
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Weekdays')
  assert.equal(daysLabel([6, 0]), 'Weekends')
  assert.equal(daysLabel([0, 3, 1]), 'Mon, Wed, Sun')
})

test('plays the mood when audio may start, and marks it fired for today', async () => {
  const started = []
  const controller = new ScheduleController(async (atm) => started.push(atm.id), () => true, () => at(7, 31))
  state().saveSchedule(schedule())
  await controller.tick()
  assert.deepEqual(started, ['morning-jazz'])
  assert.equal(state().schedules[0].lastFired, '2026-10-23')
  await controller.tick()
  assert.equal(started.length, 1, 'once a day')
})

test('without a click yet, the mood waits on the first screen instead', async () => {
  const started = []
  const controller = new ScheduleController(async (atm) => started.push(atm.id), () => false, () => at(7, 31))
  state().saveSchedule(schedule())
  await controller.tick()
  assert.deepEqual(started, [])
  assert.equal(state().scheduleReady.moodId, 'morning-jazz')
})

test('when audio refuses to start, it asks for a click', async () => {
  const controller = new ScheduleController(async () => { throw new Error('needs a click') }, () => true, () => at(7, 31))
  state().saveSchedule(schedule())
  await controller.tick()
  assert.equal(state().scheduleReady.name, 'Morning Jazz')
})

test('a deleted mood is skipped with a note', async () => {
  const controller = new ScheduleController(async () => {}, () => true, () => at(7, 31))
  state().saveSchedule(schedule({ moodId: 'my-gone' }))
  await controller.tick()
  assert.match(state().toast.text, /deleted/)
})

test('schedules survive a reload and bad saved ones are dropped', () => {
  state().saveSchedule(schedule())
  const { partialize, merge } = useRadioStore.persist.getOptions()
  const saved = JSON.parse(JSON.stringify(partialize(state())))
  saved.schedules.push({ id: 'bad', moodId: 'x', time: '25:00' }, 'nonsense', { id: 'ok', moodId: 'x', time: '06:00', days: [1, 9, 1] })
  const merged = merge(saved, useRadioStore.getInitialState())
  assert.deepEqual(merged.schedules.map((s) => s.id), ['s1', 'ok'])
  assert.deepEqual(merged.schedules[1].days, [1])
})
