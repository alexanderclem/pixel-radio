import { useEffect } from 'react'
import { consumeDeepLink, type DeepLink } from '../routing/deepLink'
import { resolveStationId } from '../social/friendStation'
import { presenceClient } from '../social/PresenceClient'
import type { SessionSettings } from '../session/setup'
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

/** A session link: show it on the power screen, and apply nothing until the listener clicks. */
async function openSessionLink(id: string, settings: Partial<SessionSettings>) {
  const store = useRadioStore.getState()
  store.setPendingSession({ stationId: id, station: null, settings })
  if (settings.view) store.flyTo(settings.view.lon, settings.view.lat, settings.view.zoom)
  const station = await resolveStationId(id)
  const pending = useRadioStore.getState().pendingSession
  if (pending?.stationId !== id) return
  if (!station) {
    store.setPendingSession(null)
    store.showToast("That shared station isn't in the directory any more")
    return
  }
  store.setPendingSession({ ...pending, station })
  if (!settings.view && station.lat !== null && station.lon !== null) store.flyTo(station.lon, station.lat, 6)
}

/** Acts on a shared link: tune a station or session, accept a friend invite, join a room. */
export function useDeepLink() {
  useEffect(() => {
    if (link?.kind === 'station') void (link.session ? openSessionLink(link.id, link.session) : openStationLink(link.id))
    if (link?.kind === 'room') {
      presenceClient.joinRoom(link.code)
      useRadioStore.getState().setDrawer('friends')
    }
    if (link?.kind === 'friend') {
      presenceClient.acceptInvite(link.code)
      useRadioStore.getState().setDrawer('friends')
    }
  }, [])
  return link
}
