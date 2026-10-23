// Fetches Natural Earth layers and writes the compact map data in src/data/.
// Run with `npm run geodata`; the outputs are committed, so this only reruns to refresh them.
import { mkdirSync, writeFileSync } from 'node:fs'
import { feature } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, quantile, simplify } from 'topojson-simplify'

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson'
const OUT = new URL('../src/data/', import.meta.url)

async function layer(name) {
  const res = await fetch(`${BASE}/${name}.geojson`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return res.json()
}

const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d

/** Topology with only geometry kept, simplified to keep only the `keep` share of its most significant points. */
function compact(collection, name, keep) {
  const features = collection.features.map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry }))
  let topo = presimplify(topology({ [name]: { type: 'FeatureCollection', features } }))
  topo = simplify(topo, quantile(topo, keep))
  // Simplified arcs still carry their weights; rebuild a lean, quantized topology
  const simplified = feature(topo, topo.objects[name])
  simplified.features = simplified.features.filter((f) => f.geometry)
  return topology({ [name]: simplified }, 1e5)
}

function write(file, data) {
  const text = JSON.stringify(data)
  writeFileSync(new URL(file, OUT), text)
  console.log(`${file}: ${(text.length / 1024).toFixed(0)} KB`)
}

mkdirSync(OUT, { recursive: true })

const [places, countries, urban, admin1] = await Promise.all([
  layer('ne_10m_populated_places_simple'),
  layer('ne_50m_admin_0_countries'),
  layer('ne_10m_urban_areas'),
  layer('ne_50m_admin_1_states_provinces_lines'),
])

write('places.json', {
  // [name, lon, lat, population, ISO country]; biggest first so label placement can go in order
  cities: places.features
    .map(({ properties: p }) => [p.nameascii || p.name, round(p.longitude), round(p.latitude), p.pop_max, p.iso_a2 === '-99' ? '' : p.iso_a2])
    .sort((a, b) => b[3] - a[3]),
  // [name, label lon, label lat, Natural Earth min label zoom]
  countries: countries.features
    // Long names ("United States of America") would crowd the map; use the short form
    .map(({ properties: p }) => [p.NAME.length > 14 ? p.ABBREV : p.NAME, round(p.LABEL_X, 2), round(p.LABEL_Y, 2), p.MIN_LABEL])
    .sort((a, b) => a[3] - b[3]),
})
write('urban.topo.json', compact(urban, 'urban', 0.05))
write('admin1.topo.json', compact(admin1, 'admin1', 0.5))
