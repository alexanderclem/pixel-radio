import { buildTerrain } from './terrain'
import { buildWorldMask } from './worldMask'

self.onmessage = async () => {
  try {
    const terrain = buildTerrain(await buildWorldMask())
    ;(self as unknown as Worker).postMessage({ ok: true, terrain }, [terrain.idx.buffer, terrain.mask.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ ok: false, error: String(err) })
  }
}
