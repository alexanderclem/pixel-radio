import { useEffect } from 'react'
import { consumeDeepLink, type DeepLink } from '../routing/deepLink'
import { resolveStationId } from '../social/friendStation'
import { presenceClient } from '../social/PresenceClient'
import { useRadioStore } from '../store/useRadioStore'

/** The link the page was opened with: read once on boot. */
const link: DeepLink | null = typeof location === 'undefined' ? null : consumeDeepLink()

export async function openStationLink(id: string) {
  const station = await resolveStationId(id)
  const store = useRadioStore.getState()
  if (!station) {
    store.showToast("Couldn't find that station; it may be off the air")
    return
  }
  if (store.powered) {
    store.requestStation(station, true)
  } else {
    // Audio needs the power-on gesture; the power screen offers this station instead
    store.setLaunch(station)
    if (station.lat !== null && station.lon !== null) store.flyTo(station.lon, station.lat, 6)
  }
}

/** Acts on a shared link: tune a station, accept a friend invite. Rooms join in useRooms. */
export function useDeepLink() {
  useEffect(() => {
    if (link?.kind === 'station') void openStationLink(link.id)
    if (link?.kind === 'friend') {
      presenceClient.acceptInvite(link.code)
      useRadioStore.getState().setDrawer('friends')
    }
  }, [])
  return link
}
