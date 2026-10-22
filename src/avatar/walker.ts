/** Degrees of longitude/latitude covered per second while walking. */
const SPEED = 30
const MIN_WALK = 1.2
const MAX_WALK = 8

export interface WalkTarget {
  id: string
  lon: number
  lat: number
}

export interface WalkerPosition {
  id: string
  lon: number
  lat: number
  walking: boolean
  /** 1 facing east, -1 facing west */
  facing: 1 | -1
}

interface WalkState {
  fromLon: number
  fromLat: number
  toLon: number
  toLat: number
  start: number
  duration: number
  facing: 1 | -1
}

const ease = (x: number) => x * x * (3 - 2 * x)

/**
 * Moves avatars between stations. Someone appearing for the first time starts at
 * their station; a new station starts a walk from wherever they currently are.
 */
export class AvatarWalker {
  private states = new Map<string, WalkState>()

  private positionOf(s: WalkState, t: number) {
    const k = s.duration > 0 ? Math.min(1, Math.max(0, (t - s.start) / s.duration)) : 1
    const e = ease(k)
    return { lon: s.fromLon + (s.toLon - s.fromLon) * e, lat: s.fromLat + (s.toLat - s.fromLat) * e, walking: k < 1 }
  }

  update(targets: readonly WalkTarget[], t: number): WalkerPosition[] {
    const seen = new Set<string>()
    const out: WalkerPosition[] = []
    for (const target of targets) {
      seen.add(target.id)
      let state = this.states.get(target.id)
      if (!state) {
        state = { fromLon: target.lon, fromLat: target.lat, toLon: target.lon, toLat: target.lat, start: t, duration: 0, facing: 1 }
        this.states.set(target.id, state)
      } else if (state.toLon !== target.lon || state.toLat !== target.lat) {
        const here = this.positionOf(state, t)
        const distance = Math.hypot(target.lon - here.lon, target.lat - here.lat)
        const dx = target.lon - here.lon
        state = {
          fromLon: here.lon,
          fromLat: here.lat,
          toLon: target.lon,
          toLat: target.lat,
          start: t,
          duration: Math.min(MAX_WALK, Math.max(MIN_WALK, distance / SPEED)),
          facing: dx < 0 ? -1 : dx > 0 ? 1 : state.facing,
        }
        this.states.set(target.id, state)
      }
      out.push({ id: target.id, ...this.positionOf(state, t), facing: state.facing })
    }
    for (const id of this.states.keys()) if (!seen.has(id)) this.states.delete(id)
    return out
  }
}
