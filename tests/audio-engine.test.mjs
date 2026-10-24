import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioEngine } from '../src/audio/AudioEngine.ts'
import { DEFAULT_AUDIO } from '../src/store/useRadioStore.ts'

function fixture(t) {
  const masterLevels = [], directLevels = [], calls = []
  const gain = () => ({ gain: { setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {} } })
  // Stand in for the physical Web Audio graph; exercise the real engine's power/volume APIs.
  const original = audioEngine.g
  audioEngine.g = {
    ctx: { currentTime: 0, resume: async () => calls.push('resume'), suspend: async () => calls.push('suspend') },
    master: { gain: { setTargetAtTime: (value) => masterLevels.push(value) } },
    padGain: gain(), hissGain: gain(), staticGain: gain(), streamGain: gain(), replacementGain: gain(),
    filter: { frequency: { setTargetAtTime() {} } }, ambient: { setLevel() {} },
    staticGen: { setBed() {}, setScan() {}, stopTuning() {} },
    stream: {
      setMuted: (muted) => calls.push(['muted', muted]),
      setDirectVolume: (value) => directLevels.push(value), stop() {},
      play: async () => { calls.push(['play', directLevels.at(-1)]); return false },
    },
  }
  t.after(() => { audioEngine.g = original })
  return { masterLevels, directLevels, calls }
}

test('direct playback is muted from the start when master is zero', async (t) => {
  const { calls, directLevels } = fixture(t)
  audioEngine.setParams({ ...DEFAULT_AUDIO, master: 0 }, true)
  await audioEngine.init()
  await audioEngine.playStation({})
  assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === 'play'), ['play', 0])
  assert.equal(directLevels.at(-1), 0)
})

test('a quick power-on supersedes an older pending suspend', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { calls } = fixture(t)
  const off = audioEngine.suspend()
  await audioEngine.init()
  t.mock.timers.tick(300)
  await off
  assert.deepEqual(calls.filter((call) => typeof call === 'string'), ['resume'])
})

test('control changes while powering off cannot unmute the graph', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { masterLevels, directLevels } = fixture(t)
  await audioEngine.init()
  const off = audioEngine.suspend()
  audioEngine.setParams({ ...DEFAULT_AUDIO, master: 1, stream: 1 }, true)
  assert.equal(masterLevels.at(-1), 0)
  assert.equal(directLevels.at(-1), 0)
  t.mock.timers.tick(300)
  await off
})

test('the sleep fade scales the whole mix and direct streams, and power-on starts at full volume', async (t) => {
  const { masterLevels, directLevels } = fixture(t)
  audioEngine.setParams({ ...DEFAULT_AUDIO, master: 1, stream: 1 }, true)
  await audioEngine.init()
  const fullMaster = masterLevels.at(-1)
  const fullDirect = directLevels.at(-1)
  audioEngine.setFade(0.25)
  assert.equal(masterLevels.at(-1), fullMaster * 0.25)
  assert.equal(directLevels.at(-1), fullDirect * 0.25)
  await audioEngine.init()
  assert.equal(masterLevels.at(-1), fullMaster, 'a new power-on is never stuck quiet')
})

test('replacement mutes direct playback and restores the current radio volume', async (t) => {
  const { directLevels } = fixture(t)
  await audioEngine.init()
  audioEngine.setParams({ ...DEFAULT_AUDIO, master: 1, stream: 1 }, true)
  const normal = directLevels.at(-1)
  assert.ok(normal > 0)
  audioEngine.setAdReplacement(true)
  assert.equal(directLevels.at(-1), 0)
  audioEngine.setParams({ ...DEFAULT_AUDIO, master: 1, stream: 0.5 }, true)
  assert.equal(directLevels.at(-1), 0)
  audioEngine.setAdReplacement(false)
  assert.ok(directLevels.at(-1) > 0 && directLevels.at(-1) < normal)
})

test('replacement silences both stream routes before raising music', async (t) => {
  const { calls } = fixture(t)
  await audioEngine.init()
  audioEngine.setParams({ ...DEFAULT_AUDIO, master: 1, stream: 1 }, true)
  audioEngine.g.streamGain.gain = {
    cancelScheduledValues: () => calls.push('cancel stream fade'),
    setValueAtTime: (level) => calls.push(['stream level', level]),
    setTargetAtTime: (level) => calls.push(['stream fade', level]),
  }
  audioEngine.g.replacementGain.gain.setTargetAtTime = (level) => calls.push(['music level', level])
  calls.length = 0
  audioEngine.setAdReplacement(true)
  assert.deepEqual(calls.slice(0, 3), [['muted', true], 'cancel stream fade', ['stream level', 0]])
  assert.ok(calls[3][1] > 0)
  assert.equal(calls[3][0], 'music level')
  audioEngine.setAdReplacement(false)
  assert.equal(calls.at(-1)[1], 0, 'replacement fades out on return')
})
