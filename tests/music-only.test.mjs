import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { station } from './helpers.mjs'
import { isTalk, isMusic, tagList } from '../src/discovery/talk.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'

let sequence = 0
const freshIndex = async () => (await import(`../src/services/stationIndex.ts?music=${sequence++}`)).stationIndex

beforeEach(() => useRadioStore.setState(useRadioStore.getInitialState(), true))

test('tags are split into lower-case phrases', () => {
  assert.deepEqual(tagList('News, Talk ,  Hip  Hop;80s/jazz'), ['news', 'talk', 'hip hop', '80s', 'jazz'])
  assert.deepEqual(tagList(''), [])
})

test('talk, news, sports and sermons are talk; music with a passing "news" is music', () => {
  const talk = [
    { tags: 'news,talk,sports' },
    { tags: 'talk' },
    { tags: 'news' },
    { tags: 'sermons,bible' },
    { tags: 'spoken word' },
    { tags: 'politics,current affairs' },
    { tags: '', name: 'BBC Radio 4' },
    { tags: '', name: 'ESPN Radio' },
    { tags: 'public radio', name: 'KQED' },
    { tags: 'talk,music' },
  ]
  for (const patch of talk) assert.equal(isTalk(station('t', patch)), true, JSON.stringify(patch))
  const music = [
    { tags: '' },
    { tags: 'jazz,smooth jazz' },
    { tags: 'news,hits' },
    { tags: 'news,pop,rock' },
    { tags: 'christian,worship' },
    { tags: 'public radio,classical' },
    { tags: 'community radio' },
    { tags: 'eclectic', source: 'curated', name: 'Talk of the Town' },
  ]
  for (const patch of music) assert.equal(isMusic(station('m', patch)), true, JSON.stringify(patch))
})

test('the filter hides stations from the map view, box queries and nearest, but not get()', async () => {
  const index = await freshIndex()
  const talk = station('talk', { tags: 'news,talk', lat: 10, lon: 10, popularity: 99 })
  const jazz = station('jazz', { tags: 'jazz', lat: 10, lon: 10.2 })
  const pop = station('pop', { tags: 'pop', lat: 10.4, lon: 10.4 })
  index.add([talk, jazz, pop])
  assert.equal(index.view().stations.length, 3)

  const before = index.version
  index.setFilter(isMusic)
  assert.ok(index.version > before, 'redraws and relights')
  const view = index.view()
  assert.deepEqual(view.stations.map((s) => s.id), ['jazz', 'pop'])
  assert.equal(view.ranks.length, view.stations.length, 'ranks stay aligned with stations')
  assert.strictEqual(index.view(), view, 'cached until something changes')

  assert.deepEqual(index.within(9, 9, 11, 11).map((s) => s.id).sort(), ['jazz', 'pop'])
  assert.deepEqual(index.nearest(10, 10, 2).map((s) => s.id), ['jazz', 'pop'], 'still fills n results')
  assert.deepEqual(index.nearest(10, 10, 1, undefined, { all: true }).map((s) => s.id), ['talk'])
  assert.equal(index.get('talk'), talk, 'a station asked for by name or link still resolves')
  assert.equal(index.keeps(talk), false)

  index.setFilter(null)
  assert.equal(index.view().stations.length, 3)
  assert.equal(index.keeps(talk), true)
})

test('the switch drives the index filter, and survives a reload', async () => {
  const { connectMusicOnly, toggleMusicOnly } = await import('../src/discovery/musicOnly.ts')
  const { stationIndex } = await import('../src/services/stationIndex.ts')
  const disconnect = connectMusicOnly()
  const talk = station('talk-2', { tags: 'talk' })
  assert.equal(stationIndex.keeps(talk), true)
  toggleMusicOnly()
  assert.equal(useRadioStore.getState().discovery.musicOnly, true)
  assert.equal(stationIndex.keeps(talk), false)
  assert.match(useRadioStore.getState().toast.text, /Music only/)

  const saved = useRadioStore.persist.getOptions().partialize(useRadioStore.getState())
  assert.deepEqual(saved.discovery, { musicOnly: true })
  const merged = useRadioStore.persist.getOptions().merge(JSON.parse(JSON.stringify(saved)), useRadioStore.getInitialState())
  assert.equal(merged.discovery.musicOnly, true)

  disconnect()
  assert.equal(stationIndex.keeps(talk), true)
})
