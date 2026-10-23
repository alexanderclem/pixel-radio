import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { station } from './helpers.mjs'
import { parseVibe } from '../src/discovery/vibes.ts'
import { vibeSearch, similarTo, surprise, trending, filteredSearch } from '../src/discovery/discover.ts'
import { qualityBadges, qualityScore } from '../src/discovery/quality.ts'
import { recordAttempt, reliabilityOf, oftenOffline, resetReliability } from '../src/discovery/reliability.ts'
import { isMusic } from '../src/discovery/talk.ts'
import { stationIndex } from '../src/services/stationIndex.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'

beforeEach(() => {
  useRadioStore.setState(useRadioStore.getInitialState(), true)
  stationIndex.setFilter(null)
  resetReliability()
})

const labels = (q) => parseVibe(q).groups.map((g) => g.label)

test('vibe words map to tag groups; phrases win over their words; filler is ignored', () => {
  assert.deepEqual(labels('Hawaiian'), ['Island'])
  assert.deepEqual(labels('island vibes'), ['Island'])
  assert.deepEqual(labels('upbeat cyberpunk'), ['Cyberpunk', 'Upbeat'])
  assert.deepEqual(labels('some night drive music please'), ['Night drive'])
  assert.equal(parseVibe('upbeat cyberpunk').known, true)
  // Unknown words are tried as tags themselves
  assert.deepEqual(parseVibe('shoegaze').groups, [{ label: 'shoegaze', tags: ['shoegaze'] }])
  assert.equal(parseVibe('shoegaze').known, false)
  assert.deepEqual(parseVibe('  the  ').groups, [])
})

test('vibe search ranks stations matching every part of the vibe first, and respects Music only', async () => {
  const both = station('both', { tags: 'synthwave,dance', popularity: 5 })
  const cyber = station('cyber', { tags: 'synthwave', popularity: 5000 })
  const dance = station('dance', { tags: 'dance,pop', popularity: 9000 })
  const talk = station('talk', { tags: 'dance,talk,news,sports' })
  const asked = []
  const searchTag = async (tag) => {
    asked.push(tag)
    return [both, cyber, dance, talk].filter((s) => s.tags.includes(tag))
  }
  const found = await vibeSearch('upbeat cyberpunk', { searchTag })
  assert.equal(found[0].id, 'both', 'matches both groups, even though it is the least popular')
  assert.deepEqual(new Set(found.map((s) => s.id)), new Set(['both', 'cyber', 'dance', 'talk']))
  assert.ok(asked.length <= 6, 'a few tags per group, not every tag')

  stationIndex.setFilter(isMusic)
  const music = await vibeSearch('upbeat cyberpunk', { searchTag })
  assert.equal(music.some((s) => s.id === 'talk'), false)
})

test('vibe search fails only when every lookup fails', async () => {
  const searchTag = async (tag) => {
    if (tag === 'hawaiian') throw new Error('down')
    return [station('t', { tags: tag })]
  }
  assert.ok((await vibeSearch('island', { searchTag })).length > 0)
  await assert.rejects(vibeSearch('island', { searchTag: async () => { throw new Error('down') } }))
})

test('more like this shares tags and language, never repeats the station, and tops up from the map', async () => {
  const self = station('self', { tags: 'jazz,smooth jazz,music', language: 'english', lat: 40, lon: -74 })
  const close = station('close', { tags: 'jazz,smooth jazz', language: 'english' })
  const far = station('far', { tags: 'jazz,bebop,swing', language: 'french' })
  const copy = station('copy', { tags: 'jazz', url: self.url })
  const neighbour = station('neighbour-1', { tags: 'rock', lat: 40.1, lon: -74.1 })
  stationIndex.add([neighbour])
  const searched = []
  const searchTag = async (tag) => {
    searched.push(tag)
    return [self, far, close, copy]
  }
  const found = await similarTo(self, { searchTag, limit: 4 })
  assert.deepEqual(found.slice(0, 2).map((s) => s.id), ['close', 'far'])
  assert.equal(found.some((s) => s.id === 'self' || s.id === 'copy'), false)
  assert.ok(found.some((s) => s.id === 'neighbour-1'), 'thin results are topped up with neighbours')
  assert.equal(searched.includes('music'), false, 'generic tags are not looked up')
})

test('trending and filtered search pass the right query and hide talk when asked', async () => {
  const queries = []
  const find = async (q) => {
    queries.push(q)
    return [station('a', { tags: 'pop' }), station('b', { tags: 'news,talk' })]
  }
  stationIndex.setFilter(isMusic)
  assert.deepEqual((await trending('BR', { find })).map((s) => s.id), ['a'])
  assert.equal(queries[0].order, 'clicktrend')
  assert.equal(queries[0].countryCode, 'BR')
  await trending(null, { find })
  assert.equal('countryCode' in queries[1], false)
  assert.deepEqual((await filteredSearch({ tag: 'pop', language: 'english' }, { find })).map((s) => s.id), ['a'])
  assert.equal(queries[2].tag, 'pop')
})

test('surprise picks by popularity, skips what is on and recent picks, and can draw from results', () => {
  const pool = [station('pop', { popularity: 10000 }), station('tiny', { popularity: 0 }), station('on')]
  useRadioStore.setState({ station: pool[2] })
  // A roll at the very start lands on the first, heaviest station
  assert.equal(surprise({ from: pool, random: () => 0 }).id, 'pop')
  assert.equal(surprise({ from: pool, random: () => 0 }).id, 'tiny', 'not the same surprise twice in a row')
  assert.equal(surprise({ from: [pool[2]] }), null, 'never what is already on')
  stationIndex.add([station('mapped', { lat: 1, lon: 1, tags: 'jazz' }), station('mapped-talk', { lat: 1, lon: 2, tags: 'talk' })])
  stationIndex.setFilter(isMusic)
  const ids = new Set(Array.from({ length: 10 }, () => surprise()?.id))
  assert.ok(ids.has('mapped'), 'without results, anything on the map')
  assert.equal(ids.has('mapped-talk'), false, 'except what Music only hides')
})

test('quality badges and reliability', () => {
  assert.deepEqual(qualityBadges(station('hq', { bitrate: 320 }), null).map((b) => b.label), ['HQ'])
  assert.deepEqual(qualityBadges(station('aac', { codec: 'AAC+', bitrate: 128 }), null).map((b) => b.label), ['HQ'])
  assert.deepEqual(qualityBadges(station('low', { bitrate: 32 }), null).map((b) => b.label), ['LOW'])
  assert.deepEqual(qualityBadges(station('flac', { codec: 'FLAC', bitrate: 0 }), null).map((b) => b.label), ['LOSSLESS'])
  assert.deepEqual(qualityBadges(station('relay', { relay: true }), null).map((b) => b.label), ['RELAY'])

  recordAttempt('flaky', false, 1000)
  assert.equal(oftenOffline(reliabilityOf('flaky', 1000)), false, 'one miss is not a pattern')
  recordAttempt('flaky', false, 2000)
  assert.equal(oftenOffline(reliabilityOf('flaky', 2000)), true)
  assert.ok(qualityBadges(station('flaky'), reliabilityOf('flaky', 2000)).some((b) => b.label === 'OFTEN OFFLINE'))
  assert.ok(qualityScore(station('flaky'), reliabilityOf('flaky', 2000)) < qualityScore(station('fine'), null))
  recordAttempt('flaky', true, 3000)
  assert.equal(oftenOffline(reliabilityOf('flaky', 3000)), false, 'playing again clears it')
  assert.equal(reliabilityOf('flaky', 3000 + 15 * 24 * 3600 * 1000), null, 'old outcomes are forgotten')
})
