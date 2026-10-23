import type { DetailTile } from './detail'
import type { Terrain } from './terrain'

export interface TerrainSource {
  terrain: Promise<Terrain>
  tile(level: number, tx: number, ty: number): Promise<DetailTile>
  /** Where the land is in one 1° tile (see buildLandTile) */
  land(tx: number, ty: number): Promise<Uint8Array>
  dispose(): void
}

type Reply = { id: number; ok: true; data: unknown } | { id: number; ok: false; error: string }

/** Everything on the page, for browsers without workers or OffscreenCanvas. */
function onPage(): TerrainSource {
  const jobs = import('./terrainJobs')
  return {
    terrain: jobs.then((j) => j.baseTerrain()),
    tile: (level, tx, ty) => jobs.then((j) => j.detailTile(level, tx, ty)),
    land: (tx, ty) => jobs.then((j) => j.landTile(tx, ty)),
    dispose() {},
  }
}

/**
 * Generate the world and its detail tiles off the main thread. If the worker fails,
 * pending and later requests fall back to the page.
 */
export function loadTerrain(): TerrainSource {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return onPage()
  const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
  let fallback: TerrainSource | null = null
  let nextId = 0
  const pending = new Map<number, {
    resolve: (v: unknown) => void
    reject: (e: unknown) => void
    retry: () => Promise<unknown>
    /** Retry on the page when the worker reports an error, not only when it dies */
    retryErrors: boolean
  }>()

  const fail = () => {
    worker.terminate()
    fallback ??= onPage()
    for (const p of pending.values()) p.retry().then(p.resolve, p.reject)
    pending.clear()
  }
  worker.onerror = fail
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.ok) p.resolve(e.data.data)
    else if (p.retryErrors) p.retry().then(p.resolve, p.reject)
    else p.reject(new Error(e.data.error))
  }

  const request = <T>(msg: object, retry: () => Promise<T>, retryErrors: boolean) => {
    if (fallback) return retry()
    return new Promise<T>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, retry, retryErrors })
      worker.postMessage({ id, ...msg })
    })
  }

  return {
    terrain: request({ type: 'base' }, () => (fallback ??= onPage()).terrain, true),
    tile: (level, tx, ty) => request({ type: 'tile', level, tx, ty }, () => (fallback ??= onPage()).tile(level, tx, ty), false),
    land: (tx, ty) => request({ type: 'land', tx, ty }, () => (fallback ??= onPage()).land(tx, ty), false),
    dispose: () => worker.terminate(),
  }
}
