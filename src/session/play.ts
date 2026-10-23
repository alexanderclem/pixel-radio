import { FALLBACK_STATIONS } from '../constants/fallbackStreams'
import { focusController } from '../focus/FocusController'
import { radio } from '../hooks/useAudioEngine'
import { stationLink } from '../routing/deepLink'
import { resolveStationId } from '../social/friendStation'
import { useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { pickStation, type Atmosphere } from './atmospheres'
import { findMood } from './moods'
import { captureSettings, sessionQuery, type SessionSettings, type Setup } from './setup'

/** Put a setup's mood in place: weather, sky, ambience and map view. Volume is left alone. */
export function applySettings(settings: Partial<SessionSettings>) {
  const s = useRadioStore.getState()
  if (settings.weather) s.setWeather(settings.weather)
  if (settings.sky) s.setSolarOverride(settings.sky)
  if (settings.mix) s.setAudio(settings.mix)
  if (settings.ambientLinked !== undefined) s.setAmbientLinked(settings.ambientLinked)
  // Settings that don't mention an atmosphere (a journey, "just the station") leave the mood alone
  if ('atmosphereId' in settings) {
    const id = settings.atmosphereId
    // Someone else's mood isn't in this library, but its link says what it's called
    const name = id ? (findMood(id)?.name ?? settings.moodName ?? null) : null
    s.setAtmosphere(id && name ? { id, name } : null)
  }
  if (settings.view) s.flyTo(settings.view.lon, settings.view.lat, settings.view.zoom)
  if (settings.timer) s.setFocusSettings({ work: settings.timer.work, short: settings.timer.short })
}

interface PlayOptions {
  /** Start the setup's focus timer too (only when it has one) */
  startTimer?: boolean
  /** What the station stands in for, when it's already a fallback */
  standIn?: Promise<string | null> | string | null
}

/**
 * Apply a mood and play its station. Call from a click: when the radio is off this powers
 * it on straight away (audio needs the gesture) and tunes once the station is known.
 */
export async function playSetup(station: Station | Promise<Station | null>, settings: Partial<SessionSettings>, { startTimer = false, standIn = null }: PlayOptions = {}) {
  const s = useRadioStore.getState()
  const powering = s.powered ? null : radio.powerOn({ tune: false })
  applySettings(settings)
  const [found, why] = await Promise.all([station, standIn, powering])
  const target = found ?? FALLBACK_STATIONS[0]
  useRadioStore.getState().requestStation(target, !settings.view, found ? (why ?? undefined) : 'that station')
  if (startTimer && settings.timer && useRadioStore.getState().focus.phase === 'idle') focusController.start()
}

export function playAtmosphere(atm: Atmosphere, { startTimer = atm.settings.timer !== null }: PlayOptions = {}) {
  const s = useRadioStore.getState()
  if (atm.pick.kind === 'keep' && s.powered && s.station && s.tuneStatus === 'playing') {
    // Only the scene changes; re-requesting the same station would restart the stream
    applySettings({ ...atm.settings, atmosphereId: atm.id })
    if (startTimer && atm.settings.timer && s.focus.phase === 'idle') focusController.start()
    return Promise.resolve()
  }
  const picked = pickStation(atm)
  return playSetup(
    picked.then((p) => p.station),
    { ...atm.settings, atmosphereId: atm.id },
    { startTimer, standIn: picked.then((p) => p.standIn) },
  )
}

/** A saved setup or the last session: the saved station is tried first, as it was. */
export function playSaved(setup: Setup, options: PlayOptions = {}) {
  return playSetup(setup.station, setup, options)
}

/** A session link the listener chose to start. */
export function playShared(stationId: string, station: Station | null, settings: Partial<SessionSettings>) {
  return playSetup(station ?? resolveStationId(stationId), settings, { startTimer: false })
}

/** Leave the atmosphere: real weather and map-linked ambience come back; the music keeps playing. */
export function leaveAtmosphere() {
  const s = useRadioStore.getState()
  s.setAtmosphere(null)
  s.setWeather({ mode: 'auto' })
  s.setSolarOverride('auto')
  s.setAmbientLinked(true)
}

/** What's playing now, with its mood, or null when nothing is playing. */
export function currentSetup(): Setup | null {
  const s = useRadioStore.getState()
  if (!s.station || s.tuneStatus !== 'playing') return null
  return { station: s.station, ...captureSettings(s) }
}

export function sessionLink(setup: Setup) {
  return `${stationLink(setup.station.id)}?${sessionQuery(setup)}`
}

export function saveCurrentSetup(name: string) {
  const setup = currentSetup()
  if (!setup) return null
  const saved = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, 40) || setup.station.name, setup, savedAt: Date.now() }
  useRadioStore.getState().saveSetup(saved)
  return saved
}
