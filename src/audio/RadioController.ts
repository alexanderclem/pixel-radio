import { audioEngine } from './AudioEngine'
import { PlaybackBlocked, StreamCancelled, type StreamEvent } from './StreamPlayer'
import { TUNING } from '../constants/audio'
import { CITY_BY_ID } from '../constants/cities'
import { FALLBACK_STATIONS } from '../constants/fallbackStreams'
import { findStationsForCity, reportClick } from '../services/radioBrowser'
import { stationIndex } from '../services/stationIndex'
import { useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { nearestCity } from '../utils/geo'

type RadioEngine = Pick<typeof audioEngine,
  'ready' | 'init' | 'suspend' | 'setParams' | 'setMood' | 'stopStream' |
  'startTuning' | 'stopTuning' | 'playStation' | 'onStreamEvent'>
type Selection = { cityId: string } | { station: Station }

/** One owner for tuning, cancellation, power transitions and bounded stream recovery. */
export class RadioController {
  private engine: RadioEngine
  private findCity: typeof findStationsForCity
  private token = 0
  private powerVersion = 0
  private powerTask: Promise<void> | null = null
  private lookup: AbortController | null = null
  private stableTimer: ReturnType<typeof setTimeout> | undefined
  private recoveries = 0
  private selection: Selection | null = null

  constructor(engine: RadioEngine = audioEngine, findCity = findStationsForCity) {
    this.engine = engine
    this.findCity = findCity
  }

  connect() {
    const state = useRadioStore.getState()
    this.engine.setParams(state.audio, state.ambientLinked)
    this.engine.onStreamEvent = this.onStreamEvent
    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (next.audio !== prev.audio || next.ambientLinked !== prev.ambientLinked) {
        this.engine.setParams(next.audio, next.ambientLinked)
      }
      if (!next.powered) return
      if (next.retryNonce !== prev.retryNonce) {
        void this.retry()
      } else if (next.selectedCityId && next.focusNonce !== prev.focusNonce) {
        void this.tuneCity(next.selectedCityId)
      } else if (next.stationRequest && next.stationRequest !== prev.stationRequest) {
        void this.tuneStation(next.stationRequest.station)
      }
    })
    return () => {
      unsubscribe()
      if (this.engine.onStreamEvent === this.onStreamEvent) this.engine.onStreamEvent = null
      void this.powerOff()
    }
  }

  private clearStable() {
    clearTimeout(this.stableTimer)
    this.stableTimer = undefined
  }

  private markStableLater() {
    this.clearStable()
    this.stableTimer = setTimeout(() => { this.recoveries = 0 }, TUNING.stablePlaybackMs)
  }

  private cancel() {
    this.token++
    this.lookup?.abort()
    this.lookup = null
    this.clearStable()
    this.engine.stopStream()
  }

  private begin(resetRecoveries = true) {
    this.cancel()
    if (resetRecoveries) this.recoveries = 0
    this.engine.startTuning()
    useRadioStore.getState().setStation(null, -1, true)
    return this.token
  }

  private current(token: number) {
    return token === this.token && useRadioStore.getState().powered
  }

  private fail(message: string) {
    this.cancel()
    const state = useRadioStore.getState()
    state.setStation(null, -1, true)
    state.setTune('error', message)
    this.engine.stopTuning()
  }

  private async lockOn(candidates: Station[], start: number, token: number, excludeId?: string) {
    const state = useRadioStore.getState()
    const ordered = candidates.slice(start).concat(candidates.slice(0, start))
    const seen = new Set<string>()
    const unique = ordered.filter((station) => {
      if (station.id === excludeId || seen.has(station.url)) return false
      seen.add(station.url)
      return true
    })
    const primary = unique[0]?.source === 'curated' ? [] : unique.filter((s) => s.source !== 'curated').slice(0, TUNING.maxAttempts)
    const fallback = unique.filter((s) => s.source === 'curated')
    for (const [group, budget] of [[primary, TUNING.primaryBudgetMs], [fallback, TUNING.fallbackBudgetMs]] as const) {
      const deadline = performance.now() + budget
      for (const station of group) {
        if (!this.current(token)) return
        const remaining = deadline - performance.now()
        if (remaining <= 0) break
        state.setTune('tuning', `${this.recoveries ? 'RECONNECTING' : 'LOCKING'} ${station.name}`)
        try {
          const analyzed = await this.engine.playStation(station, Math.min(TUNING.streamTimeoutMs, remaining))
          if (!this.current(token)) return
          state.setStation(station, candidates.findIndex((s) => s.id === station.id), analyzed)
          state.setTune('playing', station.source === 'curated' ? 'LIVE · FALLBACK' : 'LIVE')
          this.engine.stopTuning()
          this.markStableLater()
          reportClick(station)
          return
        } catch (error) {
          if (!this.current(token) || error instanceof StreamCancelled) return
          if (error instanceof PlaybackBlocked) {
            // Retry the exact blocked candidate from the next user gesture.
            this.selection = { station }
            this.fail('PRESS RETRY TO PLAY')
            return
          }
        }
      }
    }
    if (this.current(token)) this.fail('NO SIGNAL · RETRY')
  }

  private onStreamEvent = (event: StreamEvent) => {
    const state = useRadioStore.getState()
    if (!state.powered || state.station?.id !== event.station.id) return
    if (event.type === 'buffering') {
      this.clearStable()
      state.setTune('tuning', 'BUFFERING…')
    } else if (event.type === 'playing') {
      state.setTune('playing', event.station.source === 'curated' ? 'LIVE · FALLBACK' : 'LIVE')
      this.markStableLater()
    } else {
      if (this.recoveries >= TUNING.maxRecoveries) {
        this.fail('SIGNAL LOST · RETRY')
        return
      }
      this.recoveries++
      const { stations, stationIndex: index } = state
      const token = this.begin(false)
      // First drop retries this station; a repeated drop moves on to neighbours/fallbacks.
      void this.lockOn(stations, Math.max(0, index), token, this.recoveries > 1 ? event.station.id : undefined)
    }
  }

  private async tuneCity(cityId: string) {
    const city = CITY_BY_ID[cityId]
    if (!city || !this.engine.ready || !useRadioStore.getState().powered) return
    this.selection = { cityId }
    const token = this.begin()
    const state = useRadioStore.getState()
    this.engine.setMood(city.mood)
    state.setStations([...FALLBACK_STATIONS])
    state.setTune('tuning', `SCANNING ${city.name.toUpperCase()}…`)
    const lookup = new AbortController()
    this.lookup = lookup
    let found: Station[] = []
    try {
      found = await this.findCity(city, lookup.signal)
    } catch {
      // Lookup has its own deadline; curated streams still work during directory outages.
    }
    if (!this.current(token)) return
    this.lookup = null
    stationIndex.add(found)
    const candidates = [...found, ...FALLBACK_STATIONS]
    state.setStations(candidates)
    await this.lockOn(candidates, 0, token)
  }

  private async tuneStation(station: Station) {
    if (!this.engine.ready || !useRadioStore.getState().powered) return
    this.selection = { station }
    const token = this.begin()
    useRadioStore.setState({ selectedCityId: null })
    if (station.lat !== null && station.lon !== null) this.engine.setMood(nearestCity(station.lon, station.lat).city.mood)
    const neighbours = station.lat !== null && station.lon !== null ? stationIndex.nearest(station.lon, station.lat, 11, station.id) : []
    const candidates = [station, ...neighbours, ...FALLBACK_STATIONS]
    useRadioStore.getState().setStations(candidates)
    await this.lockOn(candidates, 0, token)
  }

  private async retry() {
    const version = this.powerVersion
    const token = this.token
    try {
      await this.engine.init()
      if (version !== this.powerVersion || !this.current(token)) return
      if (this.selection && 'station' in this.selection) await this.tuneStation(this.selection.station)
      else await this.tuneCity(this.selection?.cityId ?? useRadioStore.getState().selectedCityId ?? 'tokyo')
    } catch {
      if (version === this.powerVersion && this.current(token)) this.fail('AUDIO UNAVAILABLE · RETRY')
    }
  }

  stepStation = async (delta: number) => {
    const state = useRadioStore.getState()
    if (!state.powered || !state.stations.length) return
    const start = state.stationIndex < 0 ? 0 : (state.stationIndex + delta + state.stations.length) % state.stations.length
    this.selection = { station: state.stations[start] }
    const token = this.begin()
    await this.lockOn(state.stations, start, token)
  }

  powerOn = (): Promise<void> => {
    if (this.powerTask) return this.powerTask
    if (useRadioStore.getState().powered) return Promise.resolve()
    const version = ++this.powerVersion
    const task = (async () => {
      await this.engine.init()
      if (version !== this.powerVersion) return
      const state = useRadioStore.getState()
      if (this.selection && 'station' in this.selection) {
        state.setPowered(true)
        void this.tuneStation(this.selection.station)
      } else {
        const cityId = state.selectedCityId ?? 'tokyo'
        state.selectCity(cityId)
        state.setPowered(true)
        void this.tuneCity(cityId)
      }
    })()
    this.powerTask = task
    void task.finally(() => {
      if (this.powerTask === task) this.powerTask = null
    }).catch(() => {})
    return task
  }

  powerOff = async () => {
    this.powerVersion++
    this.powerTask = null
    useRadioStore.getState().setPowered(false)
    this.cancel()
    const state = useRadioStore.getState()
    state.setStation(null, -1, true)
    state.setTune('idle', 'STANDBY')
    this.engine.stopTuning()
    try {
      await this.engine.suspend()
    } catch (error) {
      console.warn('Audio context could not suspend', error)
    }
  }
}
