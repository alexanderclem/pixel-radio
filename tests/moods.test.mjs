import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { CITY_BY_ID } from '../src/constants/cities.ts'
import { FALLBACK_STATIONS } from '../src/constants/fallbackStreams.ts'
import { ATMOSPHERE_NAMES } from '../src/session/atmosphereNames.ts'
import { ATMOSPHERES, pickStation } from '../src/session/atmospheres.ts'
import { moodLine, sceneLine } from '../src/session/describe.ts'
import { customToAtmosphere, draftFrom, findMood, makeMood } from '../src/session/moods.ts'
import { applySettings } from '../src/session/play.ts'
import { parseSessionQuery, sanitizeMood, sessionQuery } from '../src/session/setup.ts'
import { mergeAccountData, sanitizeAccountData } from '../src/social/accountData.ts'
import { parseClientMessage } from '../src/social/protocol.ts'
import { EMPTY_PROGRESS } from '../src/progress/progress.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'
import { station } from './helpers.mjs'

beforeEach(() => useRadioStore.setState(useRadioStore.getInitialState(), true))

const scene = {
  weather: { mode: 'snow', density: 0.5, wind: 0.4 },
  sky: 'night',
  mix: { rain: 0, wind: 0.5, city: 0, fire: 0.8, pad: 0.3, staticBlend: 0.04, hiss: 0.08, cutoff: 0.8 },
  ambientLinked: false,
  timer: null,
}
const mood = (patch = {}) => ({ id: 'my-abc', name: 'Cabin', tagline: 'Snow and fire', pick: { kind: 'keep' }, settings: scene, savedAt: 3, ...patch })

test('every built-in mood has a preview name, a real fallback and a known city', () => {
  const ids = new Set()
  for (const atm of ATMOSPHERES) {
    assert.ok(!ids.has(atm.id), `${atm.id} is unique`)
    ids.add(atm.id)
    assert.equal(ATMOSPHERE_NAMES[atm.id], atm.name, `${atm.id} has a link-preview name`)
    assert.ok(FALLBACK_STATIONS.some((s) => s.id === atm.fallbackId), `${atm.id} falls back to a curated station`)
    if (atm.pick.kind === 'city') assert.ok(CITY_BY_ID[atm.pick.cityId], `${atm.id} picks a known city`)
    assert.match(atm.id, /^[a-z0-9-]{1,40}$/, 'fits a session link')
    assert.doesNotMatch(atm.id, /^my-/, 'never looks like a listener mood')
  }
  assert.ok(ATMOSPHERES.length >= 9)
})

test("listener moods are validated when they're read back", () => {
  const back = sanitizeMood(mood())
  assert.deepEqual({ ...back, settings: null }, { ...mood(), settings: null })
  for (const [k, v] of Object.entries(scene.mix)) assert.ok(Math.abs(back.settings.mix[k] - v) < 0.006, k)
  assert.deepEqual(sanitizeMood(back), back, 'reading it back again changes nothing')
  assert.equal(sanitizeMood(mood({ id: 'rainy-tokyo' })), null, 'ids must be my-…')
  assert.equal(sanitizeMood(mood({ name: '   ' })), null)
  assert.equal(sanitizeMood(mood({ pick: { kind: 'city', cityId: 'atlantis' } })), null)
  assert.equal(sanitizeMood(mood({ pick: { kind: 'city', cityId: 'toString' } })), null, 'only real cities')
  assert.equal(sanitizeMood(mood({ pick: { kind: 'tag', tags: ['', 5] } })), null, 'a genre pick needs a genre')
  assert.equal(sanitizeMood(mood({ settings: { ...scene, weather: { mode: 'hail' } } })), null)
  assert.equal(sanitizeMood(mood({ name: 'x'.repeat(60) })).name.length, 40)
  assert.deepEqual(sanitizeMood(mood({ pick: { kind: 'tag', tags: [' Jazz ', 'jazz', 'Soul', 'a', 'b', 'c'] } })).pick, { kind: 'tag', tags: ['jazz', 'soul', 'a', 'b'] })
  assert.equal(sanitizeMood(mood({ settings: { ...scene, timer: { work: 50, short: 10 } } })).settings.timer.work, 50)
})

test('persisted moods merge safely', () => {
  const { merge } = useRadioStore.persist.getOptions()
  const merged = merge({ library: { moods: [mood(), { id: 'my-bad' }, 'nope'] } }, useRadioStore.getInitialState())
  assert.deepEqual(merged.library.moods.map((m) => m.name), ['Cabin'])
  assert.deepEqual(merge({}, useRadioStore.getInitialState()).library.moods, [], 'older saves have none')
})

test('saving a mood again replaces it in place and renames its chip', () => {
  const s = () => useRadioStore.getState()
  s().saveMood(mood())
  s().saveMood(mood({ id: 'my-def', name: 'Second' }))
  assert.deepEqual(s().library.moods.map((m) => m.name), ['Second', 'Cabin'], 'new moods go first')
  s().setAtmosphere({ id: 'my-abc', name: 'Cabin' })
  s().saveMood(mood({ name: 'Log cabin' }))
  assert.deepEqual(s().library.moods.map((m) => m.name), ['Second', 'Log cabin'], 'edits keep their place')
  assert.equal(s().atmosphere.name, 'Log cabin')
  s().removeMood('my-def')
  assert.deepEqual(s().library.moods.map((m) => m.id), ['my-abc'])
})

test('moods are found by id, built in or your own', () => {
  assert.equal(findMood('quiet-study').name, 'Quiet Study')
  assert.equal(findMood('my-abc'), null)
  useRadioStore.getState().saveMood(mood({ pick: { kind: 'city', cityId: 'paris' } }))
  const mine = findMood('my-abc')
  assert.equal(mine.name, 'Cabin')
  assert.equal(mine.custom, true)
  assert.equal(mine.source, 'A station near Paris')
  assert.equal(moodLine({ atmosphereId: 'my-abc', weather: scene.weather }), 'Cabin · themed snow')
})

test('customizing a built-in makes a copy; editing your own keeps its id', () => {
  const copy = draftFrom(ATMOSPHERES.find((a) => a.id === 'rainy-tokyo'))
  assert.equal(copy.id, null)
  assert.equal(copy.name, 'My Rainy Tokyo')
  assert.equal(copy.settings.ambientLinked, false)
  assert.equal('view' in copy.settings, false, 'moods leave the map to the station')
  const own = draftFrom(customToAtmosphere(mood()))
  assert.equal(own.id, 'my-abc')
  assert.equal(own.name, 'Cabin')
  const made = makeMood(null, { name: 'New', tagline: '', pick: { kind: 'keep' }, settings: scene })
  assert.match(made.id, /^my-[a-z0-9]+$/)
  assert.deepEqual({ ...sanitizeMood(made), settings: null }, { ...made, settings: null }, 'what the editor makes survives storage')
})

test("a mood that keeps the music uses what's playing", async () => {
  const atm = customToAtmosphere(mood())
  const off = await pickStation(atm)
  assert.equal(off.station.source, 'curated', 'nothing playing: the curated station')
  assert.equal(off.standIn, null)
  useRadioStore.setState({ station: station('kexp'), tuneStatus: 'playing' })
  assert.equal((await pickStation(atm)).station.id, 'kexp')
})

test('the scene line says what a mood changes', () => {
  assert.equal(sceneLine(scene), 'Snow · night · synth pad, wind, fire')
  assert.equal(sceneLine({ ...scene, weather: { mode: 'auto', density: 0.5, wind: 0.5 }, sky: 'auto', mix: { ...scene.mix, wind: 0, fire: 0, pad: 0 }, timer: { work: 50, short: 10 } }), 'Live weather · no background sounds · 50-min focus')
})

test("a link to your own mood carries its name; built-in links don't", () => {
  const settings = { view: null, ...scene, atmosphereId: 'my-abc', moodName: 'Cabin' }
  const q = sessionQuery(settings)
  assert.match(q, /^atm=my-abc&mn=Cabin&/)
  assert.equal(parseSessionQuery(q).moodName, 'Cabin')
  assert.doesNotMatch(sessionQuery({ ...settings, atmosphereId: 'rainy-tokyo', moodName: 'Rainy Tokyo' }), /mn=/)
  assert.equal(parseSessionQuery('atm=rainy-tokyo&mn=Fake').moodName, undefined, 'built-ins keep their own names')
  assert.equal(parseSessionQuery('atm=my-abc&mn=%01%02').moodName, undefined, 'control characters only: no name')
  assert.equal(parseSessionQuery(`atm=my-abc&mn=${'y'.repeat(80)}`).moodName.length, 40)
})

test('a mood name with spaces still fits a room', () => {
  const mood = sessionQuery({ view: { lon: -21.94, lat: 64.15, zoom: 5 }, ...scene, timer: { work: 50, short: 10 }, atmosphereId: 'my-abc', moodName: 'Log cabin, café' })
  assert.doesNotMatch(mood, /\+/)
  assert.equal(parseSessionQuery(mood).moodName, 'Log cabin, café')
  const msg = parseClientMessage(JSON.stringify({ type: 'roomStation', station: null, mood }))
  assert.equal(msg.mood, mood, 'the room protocol accepts it')
})

test("someone else's mood shows by the name its link carries", () => {
  const s = () => useRadioStore.getState()
  applySettings({ atmosphereId: 'my-theirs', moodName: 'Their cabin', weather: scene.weather })
  assert.deepEqual(s().atmosphere, { id: 'my-theirs', name: 'Their cabin' }, 'the chip can still say the weather is themed')
  applySettings({ atmosphereId: 'my-theirs' })
  assert.equal(s().atmosphere, null, 'an unknown mood without a name is dropped')
  s().saveMood(mood())
  applySettings({ atmosphereId: 'my-abc', moodName: 'Old name' })
  assert.equal(s().atmosphere.name, 'Cabin', 'your own copy wins')
})

test('moods travel with the account and merge from both sides', () => {
  const avatar = { head: 1, hat: 2, shirt: 3, pants: 4, shoes: 5 }
  const blob = (moods) => ({ v: 1, library: { favorites: [], recents: [], setups: [], moods }, avatar, progress: EMPTY_PROGRESS })
  assert.deepEqual(sanitizeAccountData({ avatar, library: {} }).library.moods, [], 'older accounts have none')
  assert.deepEqual(sanitizeAccountData(blob([mood(), { id: 'nope' }])).library.moods.map((m) => m.id), ['my-abc'])
  const merged = mergeAccountData(blob([mood()]), blob([mood({ id: 'my-phone', name: 'Phone' })]), { preferRemoteAvatar: true })
  assert.deepEqual(merged.library.moods.map((m) => m.id), ['my-phone', 'my-abc'])
})
