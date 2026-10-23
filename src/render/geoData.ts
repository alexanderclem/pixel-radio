import type { Geometry, Position } from 'geojson'
import { feature, mesh } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import admin1Url from '../data/admin1.topo.json?url'
import urbanUrl from '../data/urban.topo.json?url'
import countries110Url from 'world-atlas/countries-110m.json?url'
import countries50Url from 'world-atlas/countries-50m.json?url'
import land10Url from 'world-atlas/land-10m.json?url'
import land50Url from 'world-atlas/land-50m.json?url'
import { unwrapLine, unwrapRing } from './worldMask'

/** A polygon's rings or a single line, unwrapped across the antimeridian, with its lon/lat box. */
export interface Shape {
  parts: Position[][]
  box: [west: number, south: number, east: number, north: number]
}

const boxOf = (parts: Position[][]): Shape['box'] => {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const part of parts) {
    for (const [lon, lat] of part) {
      if (lon < w) w = lon
      if (lon > e) e = lon
      if (lat < s) s = lat
      if (lat > n) n = lat
    }
  }
  return [w, s, e, n]
}

async function topo(url: string) {
  return (await (await fetch(url)).json()) as Topology<Record<string, GeometryCollection>>
}

function polygons(geoms: Geometry[]): Shape[] {
  const out: Shape[] = []
  for (const g of geoms) {
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const rings of list) {
      const parts = rings.map(unwrapRing)
      out.push({ parts, box: boxOf(parts) })
    }
  }
  return out
}

function lines(geoms: Geometry[]): Shape[] {
  const out: Shape[] = []
  for (const g of geoms) {
    const list = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
    for (const line of list) {
      if (line.length < 2) continue
      const parts = [unwrapLine(line)]
      out.push({ parts, box: boxOf(parts) })
    }
  }
  return out
}

async function landShapes(url: string) {
  const t = await topo(url)
  return polygons(feature(t, t.objects.land).features.map((f) => f.geometry))
}

async function borderShapes(url: string) {
  const t = await topo(url)
  return lines([mesh(t, t.objects.countries, (a, b) => a !== b)])
}

export interface BaseGeo {
  land: Shape[]
  borders: Shape[]
}

export interface DetailGeo extends BaseGeo {
  urban: Shape[]
  admin: Shape[]
}

/** Natural Earth 1:50m land and 1:110m country borders for the world grid. */
export async function loadBaseGeo(): Promise<BaseGeo> {
  const [land, borders] = await Promise.all([landShapes(land50Url), borderShapes(countries110Url)])
  return { land, borders }
}

/** 1:10m land plus urban areas and state/province lines, fetched the first time you zoom in. */
export async function loadDetailGeo(): Promise<DetailGeo> {
  const [land, b, urban, admin] = await Promise.all([
    landShapes(land10Url),
    borderShapes(countries50Url),
    topo(urbanUrl).then((t) => polygons(feature(t, t.objects.urban).features.map((f) => f.geometry))),
    topo(admin1Url).then((t) => lines(feature(t, t.objects.admin1).features.map((f) => f.geometry))),
  ])
  return { land, borders: b, urban, admin }
}
