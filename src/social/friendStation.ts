import { FALLBACK_STATIONS } from '../constants/fallbackStreams'
import { fetchStationById } from '../services/radioBrowser'
import { stationIndex } from '../services/stationIndex'
import { useRadioStore } from '../store/useRadioStore'
import type { FriendInfo, SharedStation } from './protocol'

/**
 * Turn a friend's shared station (id + labels) into a playable one. The stream URL
 * always comes from our own catalogue or Radio Browser, never from the peer.
 */
export async function resolveSharedStation(shared: SharedStation) {
  const known = stationIndex.get(shared.id) ?? FALLBACK_STATIONS.find((s) => s.id === shared.id)
  if (known || shared.curated) return known ?? null
  try {
    const station = await fetchStationById(shared.id)
    if (!station) return null
    stationIndex.add([station])
    return stationIndex.get(station.id) ?? station
  } catch {
    return null
  }
}

export async function tuneToFriend(friend: FriendInfo) {
  const shared = friend.presence?.station
  if (!shared) return
  const station = await resolveSharedStation(shared)
  const store = useRadioStore.getState()
  if (station) store.requestStation(station, true)
  else store.setFriends({ error: `Couldn't find ${shared.name} in the station directory` })
}
