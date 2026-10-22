import { avatarFromId, type Avatar } from '../avatar/parts'
import type { FriendInfo, PublicWalker } from './protocol'

export type WalkerTier = 'self' | 'friend' | 'public'

export interface WalkerTarget {
  id: string
  name: string
  avatar: Avatar
  tier: WalkerTier
  stationId: string
  stationName: string
  lon: number
  lat: number
}

/**
 * Who walks on the map: strangers from the public world (unless filtered out), then
 * friends. A friend who is also in the public world is drawn once, as a friend, and so
 * is your own public walker (you're added separately).
 */
export function worldTargets(friends: FriendInfo[], walkers: Record<string, PublicWalker>, myPid: string | null, filter: 'everyone' | 'friends'): WalkerTarget[] {
  const out: WalkerTarget[] = []
  const known = new Set<string>(myPid ? [myPid] : [])
  const friendTargets: WalkerTarget[] = []
  for (const f of friends) {
    if (f.pid) known.add(f.pid)
    const st = f.online ? f.presence?.station : null
    if (!st || st.lat === null || st.lon === null) continue
    // Friends on an older server share no avatar; give them a stable one from their id
    const avatar = f.presence?.avatar ?? avatarFromId(f.userId)
    friendTargets.push({ id: f.userId, name: f.name, avatar, tier: 'friend', stationId: st.id, stationName: st.name, lon: st.lon, lat: st.lat })
  }
  if (filter === 'everyone') {
    for (const w of Object.values(walkers)) {
      if (known.has(w.pid)) continue
      out.push({ id: w.pid, name: w.name ?? 'LISTENER', avatar: w.avatar, tier: 'public', stationId: w.station.id, stationName: w.station.name, lon: w.station.lon, lat: w.station.lat })
    }
  }
  return [...out, ...friendTargets]
}
