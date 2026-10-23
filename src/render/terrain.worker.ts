import { baseTerrain, detailTile, landTile } from './terrainJobs'

type Request =
  | { id: number; type: 'base' }
  | { id: number; type: 'tile'; level: number; tx: number; ty: number }
  | { id: number; type: 'land'; tx: number; ty: number }

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (e: MessageEvent<Request>) => {
  const req = e.data
  try {
    if (req.type === 'base') {
      // Copied rather than transferred: the worker keeps the grid to build detail tiles from
      const { idx, mask, flags } = await baseTerrain()
      post({ id: req.id, ok: true, data: { idx, mask, flags } })
    } else if (req.type === 'land') {
      const bits = await landTile(req.tx, req.ty)
      post({ id: req.id, ok: true, data: bits }, [bits.buffer])
    } else {
      const tile = await detailTile(req.level, req.tx, req.ty)
      post({ id: req.id, ok: true, data: tile }, [tile.idx.buffer, tile.flags.buffer, tile.lights.buffer])
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: String(err) })
  }
}
