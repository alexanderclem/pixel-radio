import { buildTerrain, type Terrain } from './terrain'
import { buildWorldMask } from './worldMask'

/** Generate the world off the main thread; fall back to the page if workers or OffscreenCanvas are missing. */
export function loadTerrain(): Promise<Terrain> {
  const onPage = async () => buildTerrain(await buildWorldMask())
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return onPage()
  return new Promise<Terrain>((resolve, reject) => {
    const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ ok: true; terrain: Terrain } | { ok: false; error: string }>) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.terrain)
      else onPage().then(resolve, reject)
    }
    worker.onerror = () => {
      worker.terminate()
      onPage().then(resolve, reject)
    }
    worker.postMessage(null)
  })
}
