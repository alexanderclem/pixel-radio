import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { station } from './helpers.mjs'
import { HistoryRecorder, useHistoryStore, sanitizeSessions, MAX_HISTORY_TRACKS } from '../src/history/history.ts'
import { useRadioStore } from '../src/store/useRadioStore.ts'

const state = () => useRadioStore.getState()
const sessions = () => useHistoryStore.getState().sessions
beforeEach(() => {
  useRadioStore.setState({ ...useRadioStore.getInitialState(), powered: true }, true)
  useHistoryStore.setState({ sessions: [] })
})

function setup(t) {
  const clock = { now: Date.UTC(2026, 9, 23, 20) }
  const recorder = new HistoryRecorder(() => clock.now)
  t.after(recorder.connect())
  const play = (s) => { state().setStation(s, 0, true); state().setTune('playing', 'LIVE') }
  return { clock, recorder, play }
}

test('a session per station, with its songs, and buffering or a reconnect continues it', (t) => {
  const { clock, play } = setup(t)
  const jazz = station('jazz', { name: 'Jazz FM' })
  play(jazz)
  assert.equal(sessions().length, 1)
  state().setNowPlaying({ stationId: 'jazz', title: 'Miles Davis - So What' })
  state().setNowPlaying({ stationId: 'jazz', title: 'Miles Davis - So What' })
  clock.now += 60_000
  // Buffering, then a recovery re-lock of the same station
  state().setTune('tuning', 'BUFFERING…')
  state().setStation(null, -1, true)
  play(jazz)
  state().setNowPlaying({ stationId: 'jazz', title: 'Bill Evans - Peace Piece' })
  assert.equal(sessions().length, 1)
  assert.deepEqual(sessions()[0].tracks.map((x) => x.title), ['Miles Davis - So What', 'Bill Evans - Peace Piece'])
  assert.ok(sessions()[0].endedAt > sessions()[0].startedAt)
})

test('stations only skipped past are not kept; songs for another station are ignored', (t) => {
  const { clock, play } = setup(t)
  play(station('a'))
  clock.now += 5_000
  play(station('b'))
  assert.deepEqual(sessions().map((s) => s.station.id), ['b'], 'five seconds on a, no songs: dropped')
  state().setNowPlaying({ stationId: 'a', title: 'Late title from a' })
  assert.deepEqual(sessions()[0].tracks, [])
  clock.now += 60_000
  state().setNowPlaying({ stationId: 'b', title: 'Song' })
  play(station('c'))
  assert.deepEqual(sessions().map((s) => s.station.id), ['c', 'b'])
})

test('curated fallbacks and standby are not history', (t) => {
  const { play } = setup(t)
  play(station('rp', { source: 'curated' }))
  assert.equal(sessions().length, 0)
})

test('history keeps within its caps and survives a reload, dropping bad entries', () => {
  const many = Array.from({ length: 3 }, (_, i) => ({
    id: `s${i}`, station: station(`st${i}`), startedAt: i, endedAt: i + 1,
    tracks: Array.from({ length: 600 }, (_, j) => ({ title: `t${j}`, at: j })),
  }))
  useHistoryStore.setState({ sessions: many })
  const { merge, partialize } = useHistoryStore.persist.getOptions()
  const saved = JSON.parse(JSON.stringify(partialize(useHistoryStore.getState())))
  saved.sessions.push({ id: 'bad' }, null)
  const merged = merge(saved, useHistoryStore.getInitialState())
  assert.equal(merged.sessions.length, 3)
  assert.deepEqual(sanitizeSessions('nope'), [])
  assert.ok(MAX_HISTORY_TRACKS === 1000)
})

test('recording trims old songs past the cap', (t) => {
  const { play } = setup(t)
  useHistoryStore.setState({
    sessions: [{ id: 'old', station: station('old'), startedAt: 0, endedAt: 60_000, tracks: Array.from({ length: 1000 }, (_, j) => ({ title: `t${j}`, at: j })) }],
  })
  play(station('new'))
  state().setNowPlaying({ stationId: 'new', title: 'Fresh' })
  const total = sessions().reduce((n, s) => n + s.tracks.length, 0)
  assert.equal(total, 1000)
  assert.equal(sessions()[0].tracks[0].title, 'Fresh')
  assert.equal(sessions()[1].tracks[0].title, 't1', 'the oldest song went')
})

test('saved songs toggle, dedupe across stations, survive a reload and travel with the account', async () => {
  const { sanitizeAccountData, mergeAccountData, snapshot } = await import('../src/social/accountData.ts')
  state().toggleTrack({ title: 'Nujabes - Aruarian Dance', stationId: 'a', stationName: 'A' })
  state().toggleTrack({ title: 'nujabes  - aruarian dance', stationId: 'b', stationName: 'B' })
  assert.equal(state().library.tracks.length, 0, 'the same song again forgets it')
  state().toggleTrack({ title: 'Nujabes - Aruarian Dance', stationId: 'a', stationName: 'A' })
  const { partialize, merge } = useRadioStore.persist.getOptions()
  const merged = merge(JSON.parse(JSON.stringify(partialize(state()))), useRadioStore.getInitialState())
  assert.equal(merged.library.tracks[0].title, 'Nujabes - Aruarian Dance')

  const local = snapshot(state())
  const remote = sanitizeAccountData({ ...local, library: { ...local.library, tracks: [{ id: 'x', title: 'Other', stationId: 'c', savedAt: 1 }, { bad: true }] } })
  assert.equal(remote.library.tracks.length, 1)
  const both = mergeAccountData(local, remote, { preferRemoteAvatar: false })
  assert.deepEqual(both.library.tracks.map((x) => x.title), ['Other', 'Nujabes - Aruarian Dance'])
})
