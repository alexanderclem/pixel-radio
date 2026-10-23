import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BORDER, levelFor, LEVELS, rasterLine, rasterShapes, tileBounds, tileDeg, visibleTiles } from '../src/render/detail.ts'
import { cityMinZoom, placeLabels } from '../src/render/labels.ts'
import { slotOnLand, snapToLand } from '../src/render/landMask.ts'
import { wrapLine } from '../src/render/mapRenderer.ts'
import { clusterLevel, spreadAt, spreadOffset, SPREAD_PX } from '../src/render/stack.ts'
import { coastDistance } from '../src/render/terrain.ts'
import { stationIndex } from '../src/services/stationIndex.ts'
import { station } from './helpers.mjs'

test('detail level is the finest whose cells still cover a pixel', () => {
  assert.equal(levelFor(3), 0)
  assert.equal(levelFor(15.9), 0)
  assert.equal(levelFor(16), 1)
  assert.equal(levelFor(63), 1)
  assert.equal(levelFor(64), 2)
  assert.equal(levelFor(256), 3)
  assert.equal(levelFor(5000), 3)
})

test('detail tiles divide the world exactly', () => {
  for (let l = 1; l < LEVELS.length; l++) {
    assert.equal(Number.isInteger(360 / tileDeg(l)), true)
    assert.equal(Number.isInteger(180 / tileDeg(l)), true)
    assert.equal(LEVELS[l].size % 4, 0, 'tile size keeps the 4×4 dither seamless')
  }
  assert.equal(visibleTiles(1, -180, 90, 180, -90).length, 24 * 12)
  assert.deepEqual(tileBounds(3, 105, 49), { west: -75, north: 41, deg: 1 })
})

test('visible tiles cover the view, nearest the centre first', () => {
  // A view over New York straddling two 1° tiles, centred in the western one
  const tiles = visibleTiles(3, -74.9, 40.9, -73.7, 40.5)
  assert.deepEqual(tiles, [{ tx: 105, ty: 49 }, { tx: 106, ty: 49 }])
  // Views hanging off the map edge clamp to real tiles
  assert.deepEqual(visibleTiles(2, -185, 95, -179, 88), [{ tx: 0, ty: 0 }])
})

test('lines rasterise dashed and connected', () => {
  const w = 12
  const flags = new Uint8Array(w * 3)
  rasterLine(flags, w, 3, [[0, 1], [11, 1]], BORDER, 3, 2)
  assert.equal([...flags.slice(w, 2 * w)].join(''), '110110110110')

  // A solid diagonal touches one cell per step with no gaps
  const diag = new Uint8Array(5 * 5)
  rasterLine(diag, 5, 5, [[0, 0], [4.5, 4.5]], 1, 1, 1)
  for (let i = 0; i < 5; i++) assert.equal(diag[i * 5 + i], 1)
  assert.equal(diag.reduce((a, b) => a + b, 0), 5)

  // Segments entirely off the grid are skipped; ones crossing it are clipped
  const clip = new Uint8Array(4 * 4)
  rasterLine(clip, 4, 4, [[-10, 1], [-2, 1], [6, 1]], 1, 1, 1)
  assert.equal([...clip.slice(4, 8)].join(''), '1111')
  assert.equal(clip.reduce((a, b) => a + b, 0), 4)
})

test('shapes across the antimeridian land on both edges of the world', () => {
  const flags = new Uint8Array(8 * 4)
  // A line from 175°E to 185°E (unwrapped), on a 45°-per-cell world grid
  rasterShapes(flags, 8, 4, [{ parts: [[[175, 10], [185, 10]]], box: [175, 10, 185, 10] }], -180, 90, 45, BORDER, 1, 1)
  assert.equal(flags[1 * 8 + 7], BORDER)
  assert.equal(flags[1 * 8 + 0], BORDER)
})

test('coast distance grows away from the shore and wraps only when asked', () => {
  const w = 6
  // Land in the two left columns
  const mask = Uint8Array.from({ length: w * 3 }, (_, i) => (i % w < 2 ? 1 : 0))
  const flat = coastDistance(mask, w, 3, 9, false)
  assert.deepEqual([...flat.slice(0, w)], [1, 0, 0, 1, 2, 3])
  const wrapped = coastDistance(mask, w, 3, 9, true)
  assert.deepEqual([...wrapped.slice(0, w)], [0, 0, 0, 1, 1, 0])
})

test('stations sharing a spot get increasing stack ranks', () => {
  stationIndex.add([
    station('stack-a', { lat: 12.3456, lon: 45.6789, country: 'ZZ' }),
    station('stack-b', { lat: 12.34561, lon: 45.67892, country: 'ZZ' }),
    station('stack-c', { lat: 12.3456, lon: 45.6789, country: 'ZZ' }),
    station('stack-d', { lat: 12.5, lon: 45.6789, country: 'ZZ' }),
  ])
  assert.deepEqual(['stack-a', 'stack-b', 'stack-c', 'stack-d'].map((id) => stationIndex.rank(id)), [0, 1, 2, 0])
  const i = stationIndex.placed.findIndex((s) => s.id === 'stack-c')
  assert.equal(stationIndex.stackRank[i], 2)
  assert.deepEqual(stationIndex.within(45, 12, 46, 12.4).map((s) => s.id).sort(), ['stack-a', 'stack-b', 'stack-c'])
})

test('stacked stations fan out on a spiral without overlapping', () => {
  assert.deepEqual(spreadOffset(0, 1), [0, 0])
  assert.deepEqual(spreadOffset(5, 0), [0, 0])
  assert.equal(spreadAt(4), 0)
  assert.equal(spreadAt(320), 1)
  const pts = Array.from({ length: 60 }, (_, r) => spreadOffset(r, 1))
  let min = Infinity
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) min = Math.min(min, Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]))
  }
  assert.ok(min >= SPREAD_PX * 0.8, `markers ${min.toFixed(1)}px apart`)
})

test('station clusters regroup only once the zoom is clearly in another octave', () => {
  assert.equal(clusterLevel(1, Number.NaN), 0)
  assert.equal(clusterLevel(6, Number.NaN), 3)
  // Hovering around the halfway point (2^1.5) keeps whichever level it came from
  for (const z of [2.7, 2.83, 2.95, 3.05]) {
    assert.equal(clusterLevel(z, 1), 1)
    assert.equal(clusterLevel(z, 2), 2)
  }
  assert.equal(clusterLevel(3.3, 1), 2)
  assert.equal(clusterLevel(2.4, 2), 1)
  // A big jump lands straight on the nearest octave
  assert.equal(clusterLevel(100, 1), 7)
})

test('labels appear by population and never overlap', () => {
  assert.ok(cityMinZoom(2e7) < cityMinZoom(2e6))
  assert.ok(cityMinZoom(2e6) < cityMinZoom(2e5))
  assert.ok(cityMinZoom(2e5) < cityMinZoom(5e3))
  const items = [
    { id: 'big', rect: [0, 0, 50, 10] },
    { id: 'overlaps-big', rect: [40, 5, 90, 15] },
    { id: 'clear', rect: [60, 20, 100, 30] },
    { id: 'reserved', rect: [200, 0, 220, 10] },
  ]
  assert.deepEqual(placeLabels(items, [[195, 0, 205, 5]]).map((l) => l.id), ['big', 'clear'])
})

test('stations in the water snap to the nearest land clear of the shoreline', () => {
  const coast = (lon) => lon < 0
  const [lon, lat] = snapToLand(coast, 0.05, 10)
  // The cell right on the coast has sea beside it; the next one in is clear
  assert.ok(Math.abs(lon - -1.5 / 256) < 1e-9, `lon ${lon}`)
  assert.ok(Math.abs(lat - 10) < 1 / 256)
  assert.deepEqual(snapToLand(coast, -2, 10), [-2, 10], 'already on land')
  assert.deepEqual(snapToLand(coast, 1, 10), [1, 10], 'no land within reach')
  assert.equal(snapToLand(() => null, 1, 10), null, 'land still loading')
  // A one-cell islet beats a clear mainland cell across a wide strait
  const islet = (lon, lat) => lon < -0.1 || (Math.floor(lon * 256) === 10 && Math.floor(lat * 256) === 10)
  const [ilon] = snapToLand(islet, 12 / 256, 10.5 / 256)
  assert.equal(Math.floor(ilon * 256), 10)
})

test('fanned-out slots count as on land only if every zoom keeps them there', () => {
  const coast = (lon) => lon < 0
  let rejected = 0
  for (let k = 1; k < 30; k++) {
    const ok = slotOnLand(coast, -0.03, 20, k)
    const [ox] = spreadOffset(k, 1)
    assert.equal(ok, -0.03 + (ox * 1.25) / 200 < 0, `slot ${k}`)
    if (!ok) rejected++
  }
  assert.ok(rejected > 5)
  assert.equal(slotOnLand(() => null, 0, 0, 3), null)
})

test('tooltip lines wrap once, then get cut short', () => {
  assert.deepEqual(wrapLine('Yet Radio', 30, 2), ['Yet Radio'])
  const song = '♪ Explore Exclusive live tv channels & radio stations all in one place. Download Yet+ now'
  const lines = wrapLine(song, 30, 2)
  assert.equal(lines.length, 2)
  assert.ok(lines.every((l) => l.length <= 30))
  assert.equal(lines[0], '♪ Explore Exclusive live tv')
  assert.ok(lines[1].endsWith('…'))
  assert.deepEqual(wrapLine('x'.repeat(40), 30, 1), [`${'x'.repeat(29)}…`])
})
