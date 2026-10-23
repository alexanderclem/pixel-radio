import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ambientOf, cellOf, formatTemp, fromOpenMeteo, LiveWeatherService, openMeteoUrl } from '../src/weather/liveWeather.ts'
import { computeAmbientMix } from '../src/utils/geo.ts'
import { flush } from './helpers.mjs'

const body = (current) => ({ current: { weather_code: 0, temperature_2m: 14.4, wind_speed_10m: 0, wind_direction_10m: 0, ...current } })

test('WMO codes map to drawable weather', () => {
  assert.deepEqual(fromOpenMeteo(body({ weather_code: 0 })), { type: 'clear', intensity: 0, wind: 0, label: 'CLEAR', tempC: 14 })
  assert.equal(fromOpenMeteo(body({ weather_code: 3 })).label, 'CLOUDY')
  assert.equal(fromOpenMeteo(body({ weather_code: 45 })).label, 'FOG')
  assert.deepEqual(
    [61, 63, 65].map((c) => fromOpenMeteo(body({ weather_code: c }))).map((w) => [w.type, w.label]),
    [['rain', 'RAIN'], ['rain', 'RAIN'], ['rain', 'RAIN']],
  )
  const [light, heavy] = [61, 65].map((c) => fromOpenMeteo(body({ weather_code: c })).intensity)
  assert.ok(heavy > light, 'heavier codes draw more rain')
  assert.equal(fromOpenMeteo(body({ weather_code: 75 })).type, 'snow')
  assert.equal(fromOpenMeteo(body({ weather_code: 95 })).type, 'storm')
  assert.ok(['clear', 'rain', 'storm', 'snow'].includes(fromOpenMeteo(body({ weather_code: 57 })).type))
})

test('unusable responses are rejected', () => {
  assert.equal(fromOpenMeteo(null), null)
  assert.equal(fromOpenMeteo({}), null)
  assert.equal(fromOpenMeteo(body({ weather_code: 42 })), null, 'unknown code')
  assert.equal(fromOpenMeteo(body({ weather_code: '61' })), null)
  assert.equal(fromOpenMeteo(body({ temperature_2m: 'warm' })).tempC, null)
  assert.equal(fromOpenMeteo(body({ wind_speed_10m: NaN })).wind, 0)
})

test('wind blows away from where it comes from', () => {
  const westerly = fromOpenMeteo(body({ wind_speed_10m: 20, wind_direction_10m: 270 })).wind
  const easterly = fromOpenMeteo(body({ wind_speed_10m: 20, wind_direction_10m: 90 })).wind
  const northerly = fromOpenMeteo(body({ wind_speed_10m: 20, wind_direction_10m: 0 })).wind
  assert.ok(westerly > 0.4 && westerly <= 1, 'a westerly drifts right')
  assert.ok(easterly < -0.4, 'an easterly drifts left')
  assert.equal(northerly, 0, 'a northerly has no sideways drift')
  assert.equal(fromOpenMeteo(body({ wind_speed_10m: 200, wind_direction_10m: 270 })).wind, 1, 'gales are clamped')
})

test('live weather drives the rain and wind beds', () => {
  const rain = ambientOf(fromOpenMeteo(body({ weather_code: 65, wind_speed_10m: 0 })))
  const clear = ambientOf(fromOpenMeteo(body({ weather_code: 0, wind_speed_10m: 0 })))
  const gale = ambientOf(fromOpenMeteo(body({ weather_code: 0, wind_speed_10m: 80, wind_direction_10m: 90 })))
  assert.ok(rain.rain > 0.8)
  assert.equal(clear.rain, 0)
  assert.ok(gale.wind > 0.9 && clear.wind < 0.3)

  // Tokyo's preset is rainy; real clear skies there silence the rain when zoomed in
  const preset = computeAmbientMix(139.69, 35.68, 6)
  const live = computeAmbientMix(139.69, 35.68, 6, { rain: 0, wind: 0.2 })
  assert.ok(preset.rain > 0.3)
  assert.ok(live.rain < 0.01)
  assert.ok(Math.abs(live.city - preset.city) < 1e-9, 'the city bed keeps its preset')
  const world = computeAmbientMix(139.69, 35.68, 1, { rain: 1, wind: 1 })
  assert.equal(world.rain, 0.25, 'zoomed out, the planetary bed wins')
})

test('cells round to half a degree and wrap the antimeridian', () => {
  assert.deepEqual(cellOf(35.68, 139.69), { lat: 35.5, lon: 139.5, key: '35.5,139.5' })
  assert.equal(cellOf(35.8, 139.8).key, '36,140')
  assert.equal(cellOf(10, 179.9).lon, -180)
  assert.equal(cellOf(10, -180.2).lon, -180)
  assert.equal(cellOf(95, 0).lat, 90)
  assert.match(openMeteoUrl(35.5, 139.5), /latitude=35\.5&longitude=139\.5&current=weather_code,/)
})

test('temperatures follow the reader’s locale', () => {
  assert.equal(formatTemp(20, 'en-US'), '68°F')
  assert.equal(formatTemp(20, 'en-GB'), '20°C')
  assert.equal(formatTemp(-3, 'de'), '-3°C')
  assert.equal(formatTemp(20, '!!'), '20°C')
})

function service(responses) {
  let now = 0
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return { ok: next.ok ?? true, json: async () => next.body }
  }
  const svc = new LiveWeatherService({ fetchImpl, now: () => now })
  return { svc, calls, tick: (ms) => (now += ms) }
}

test('the service caches per cell, refreshes when stale and backs off on failure', async () => {
  const { svc, calls, tick } = service([
    { body: body({ weather_code: 63 }) },
    { body: body({ weather_code: 0 }) },
    new Error('offline'),
  ])
  assert.equal(svc.get(35.68, 139.69), null, 'nothing until the first answer')
  await flush()
  assert.equal(svc.get(35.6, 139.6).type, 'rain', 'a nearby point shares the cell')
  assert.equal(calls.length, 1)

  tick(21 * 60_000)
  assert.equal(svc.get(35.68, 139.69).type, 'rain', 'stale weather shows while refreshing')
  await flush()
  assert.equal(svc.get(35.68, 139.69).type, 'clear')
  assert.equal(calls.length, 2)

  tick(21 * 60_000)
  svc.get(35.68, 139.69)
  await flush()
  assert.equal(svc.get(35.68, 139.69).type, 'clear', 'a failed refresh keeps the last weather')
  tick(60_000)
  svc.get(35.68, 139.69)
  assert.equal(calls.length, 3, 'waits before retrying')
})

test('one request at a time; a bad answer counts as a failure', async () => {
  const { svc, calls, tick } = service([{ ok: false, body: null }, { body: body({ weather_code: 71 }) }])
  svc.get(64.15, -21.94)
  svc.get(35.68, 139.69)
  assert.equal(calls.length, 1)
  await flush()
  assert.equal(svc.get(64.15, -21.94), null)
  svc.get(35.68, 139.69)
  await flush()
  assert.equal(svc.get(35.68, 139.69).type, 'snow', 'the other cell loads once the first is done')
  tick(60_000)
  svc.get(64.15, -21.94)
  assert.equal(calls.length, 2, 'the failed cell waits out its retry delay')
})
