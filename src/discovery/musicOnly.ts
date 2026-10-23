import { stationIndex } from '../services/stationIndex'
import { useRadioStore } from '../store/useRadioStore'
import { isMusic } from './talk'

/** Keep the station index's filter in step with the "Music only" switch. */
export function connectMusicOnly() {
  const apply = () => stationIndex.setFilter(useRadioStore.getState().discovery.musicOnly ? isMusic : null)
  apply()
  const unsubscribe = useRadioStore.subscribe((next, prev) => {
    if (next.discovery.musicOnly !== prev.discovery.musicOnly) apply()
  })
  return () => {
    unsubscribe()
    stationIndex.setFilter(null)
  }
}

/** Flip "Music only"; what's playing keeps playing either way. */
export function toggleMusicOnly() {
  const s = useRadioStore.getState()
  const on = !s.discovery.musicOnly
  s.setDiscovery({ musicOnly: on })
  s.showToast(on ? 'Music only: talk, news and sports stations are hidden' : 'Showing every station')
}
