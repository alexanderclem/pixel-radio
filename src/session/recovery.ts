import { stationIndex } from '../services/stationIndex'
import { findMood } from './moods'
import { playAtmosphere } from './play'
import { useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'

/** Try the station that didn't answer again (or the whole tune, when it was a city scan). */
export function retryWanted() {
  const s = useRadioStore.getState()
  const wanted = s.fallback?.wantedStation
  const atm = s.atmosphere ? findMood(s.atmosphere.id) : null
  if (wanted) s.requestStation(wanted, false)
  // The directory was down when the atmosphere picked its station: ask it again
  else if (s.fallback?.reason === 'directory' && atm) void playAtmosphere(atm, { startTimer: false })
  else s.retryTune()
}

/**
 * A different working-looking station near the one that was asked for (not near the
 * stand-in, which may be on another continent). Null when there's nothing to offer.
 */
export function nearbyAlternative(wanted: Station | null, playing: Station | null, tried: string[] = []): Station | null {
  const skip = new Set([wanted?.id, playing?.id, ...tried].filter(Boolean) as string[])
  if (wanted?.lat != null && wanted.lon != null) {
    const near = stationIndex.nearest(wanted.lon, wanted.lat, 12, wanted.id).find((x) => !skip.has(x.id))
    if (near) return near
  }
  // No position to search around: the next candidate the tuner already has
  const { stations } = useRadioStore.getState()
  return stations.find((x) => !skip.has(x.id) && x.source !== 'curated') ?? null
}

const triedNearby: string[] = []

export function playAnotherNearby() {
  const s = useRadioStore.getState()
  const wanted = s.fallback?.wantedStation ?? null
  const next = nearbyAlternative(wanted, s.station, triedNearby)
  if (!next) {
    s.showToast('No other stations nearby on the map yet')
    return
  }
  triedNearby.push(next.id)
  if (triedNearby.length > 20) triedNearby.shift()
  s.requestStation(next, true)
}
