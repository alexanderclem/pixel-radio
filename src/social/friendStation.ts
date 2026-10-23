import { FALLBACK_STATIONS } from '../constants/fallbackStreams'
import { fetchStationById } from '../services/radioBrowser'
import { stationIndex } from '../services/stationIndex'
import { useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import type { FriendInfo, SharedStation } from './protocol'

/**
 * Turn a station id (from a friend, a shared link or a room) into a playable station.
 * The stream URL always comes from our own catalogue or Radio Browser, never from a peer.
 */
export async function resolveStationId(id: string, curated = false): Promise<Station | null> {
  const known = stationIndex.get(id) ?? FALLBACK_STATIONS.find((s) => s.id === id)
  if (known || curated) return known ?? null
  try {
    const station = await fetchStationById(id)
    if (!station) return null
    stationIndex.add([station])
    return stationIndex.get(station.id) ?? station
  } catch {
    return null
  }
}

export const resolveSharedStation = (shared: SharedStation) => resolveStationId(shared.id, shared.curated)

export async function tuneToFriend(friend: FriendInfo) {
  const shared = friend.presence?.station
  if (!shared) return
  const station = await resolveSharedStation(shared)
  const store = useRadioStore.getState()
  if (station) store.requestStation(station, true)
  else store.setFriends({ error: `Couldn't find ${shared.name} in the station directory` })
}
