import { mapView } from '../render/mapSnapshot'
import { stationLink } from '../routing/deepLink'
import { currentSong, useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { localTimeAt } from '../utils/time'
import { formatTemp, liveWeather } from '../weather/liveWeather'
import { drawCard, type CardInfo } from './card'

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

export const canShareNatively = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/** Copy to the clipboard and say so; false when the browser refuses. */
export async function copyText(text: string, notice: string) {
  try {
    await navigator.clipboard.writeText(text)
    useRadioStore.getState().showToast(notice)
    return true
  } catch {
    useRadioStore.getState().showToast("Couldn't reach the clipboard")
    return false
  }
}

export function shareTextFor(station: Station, song: string | null) {
  return song ? `${song} on ${station.name}, live from ${station.location}` : `${station.name}, live from ${station.location}`
}

/** The system share sheet where there is one, else copy the link. */
export async function shareStationLink(station: Station) {
  const url = stationLink(station.id)
  if (canShareNatively()) {
    try {
      await navigator.share({ title: `${station.name} · Pixel Radio`, text: shareTextFor(station, currentSong(useRadioStore.getState())), url })
      return
    } catch (err) {
      if (isAbort(err)) return
    }
  }
  await copyText(url, 'Link copied')
}

export function cardInfoFor(station: Station): CardInfo {
  const s = useRadioStore.getState()
  const placed = station.lat !== null && station.lon !== null
  const weather = placed && s.weather.mode === 'auto' ? liveWeather.get(station.lat!, station.lon!) : null
  return {
    stationName: station.name,
    place: station.location,
    lat: station.lat,
    lon: station.lon,
    song: currentSong(s),
    time: placed ? localTimeAt(station.lon!, station.lat!, false) : null,
    weather: weather ? `${weather.label}${weather.tempC === null ? '' : ` ${formatTemp(weather.tempC)}`}` : null,
    avatar: s.avatar,
    url: stationLink(station.id),
  }
}

/** A picture of what you're hearing: shared as a file where supported, else downloaded. */
export async function shareStationImage(station: Station) {
  const store = useRadioStore.getState()
  let blob: Blob
  try {
    blob = await drawCard(cardInfoFor(station), mapView())
  } catch {
    store.showToast("Couldn't make the image")
    return
  }
  const slug = station.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'station'
  const file = new File([blob], `pixel-radio-${slug}.png`, { type: 'image/png' })
  if (canShareNatively() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: station.name, url: stationLink(station.id) })
      return
    } catch (err) {
      if (isAbort(err)) return
    }
  }
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
  store.showToast('Image saved')
}
