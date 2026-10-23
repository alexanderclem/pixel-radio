import { baseFlags, buildLandTile, buildTile, type DetailTile } from './detail'
import { loadBaseGeo, loadDetailGeo, type DetailGeo } from './geoData'
import { buildTerrain, type BaseTerrain } from './terrain'
import { buildWorldMask } from './worldMask'

let base: Promise<BaseTerrain> | null = null
let geo: Promise<DetailGeo> | null = null

/** The world grid, built once per thread. */
export const baseTerrain = () =>
  (base ??= loadBaseGeo().then((g) => buildTerrain(buildWorldMask(g.land.map((s) => s.parts)), baseFlags(g.borders))))

/** One detail tile; the 1:10m data is fetched on the first request. */
export async function detailTile(level: number, tx: number, ty: number): Promise<DetailTile> {
  const [b, g] = await Promise.all([baseTerrain(), (geo ??= loadDetailGeo())])
  return buildTile(b, g, level, tx, ty)
}

/** Where the land is in one 1° tile (see buildLandTile). */
export async function landTile(tx: number, ty: number): Promise<Uint8Array> {
  const [b, g] = await Promise.all([baseTerrain(), (geo ??= loadDetailGeo())])
  return buildLandTile(b, g.land, tx, ty)
}
