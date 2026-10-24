import { AdReplacement, useAdReplacement } from '../audio/AdReplacement'
import { audioEngine } from '../audio/AudioEngine'
import { PRESENCE_URL } from '../social/identity'
import { currentSong, useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { cleanTitle, parseIcecastStatus } from './parse'

type TitleEngine = Pick<typeof audioEngine, 'onStreamTitle'>

export const adReplacement = new AdReplacement((active) => audioEngine.setAdReplacement(active))

const POLL_MS = 20_000
const HIDDEN_POLL_MS = 60_000

/** Radio Paradise channels behind the curated fallback stations. */
const PARADISE_CHANNEL: Record<string, number> = { 'rp-main': 0, 'rp-mellow': 1, 'rp-world': 3 }

const isHls = (s: Station) => s.hls || /\.m3u8(?:\?|$)/i.test(s.url)

interface Options {
  engine?: TitleEngine
  presenceUrl?: string
  fetchImpl?: typeof fetch
}

/**
 * Finds out what song the playing station is on, best effort:
 * 1. titles inside the stream (HLS ID3 metadata, pushed by the player),
 * 2. the station's own Icecast status page, when it allows cross-origin reads,
 * 3. the presence Worker reading the stream's ICY metadata server-side,
 * plus Radio Paradise's API for the curated fallbacks.
 */
const ARTWORK = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
]

export class NowPlaying {
  private engine: TitleEngine
  private presenceUrl: string
  private fetchImpl: typeof fetch
  private timer: ReturnType<typeof setTimeout> | undefined
  private stationId: string | null = null
  private abort: AbortController | null = null
  /** Per station: whether its status page answered, so dead ends aren't retried every poll */
  private statusWorks = new Map<string, boolean>()

  constructor({ engine = audioEngine, presenceUrl = PRESENCE_URL, fetchImpl = (...a) => fetch(...a) }: Options = {}) {
    this.engine = engine
    this.presenceUrl = presenceUrl
    this.fetchImpl = fetchImpl
  }

  connect() {
    const disconnectAds = adReplacement.connect()
    this.engine.onStreamTitle = (station, title) => {
      const s = useRadioStore.getState()
      const clean = cleanTitle(title, station.name)
      if (clean && s.station?.id === station.id) {
        if (s.powered) adReplacement.title(clean)
        s.setNowPlaying({ stationId: station.id, title: clean })
      }
    }
    const sync = () => {
      const s = useRadioStore.getState()
      const playing = s.powered && (s.tuneStatus === 'playing' || s.tuneStatus === 'tuning') && s.station ? s.station : null
      if (playing?.id === this.stationId) return
      this.stop()
      adReplacement.reset()
      if (s.nowPlaying && s.nowPlaying.stationId !== playing?.id) s.setNowPlaying(null)
      if (playing) {
        this.stationId = playing.id
        void this.poll(playing)
      }
    }
    sync()
    const unsubscribeAds = useAdReplacement.subscribe((next, prev) => {
      if (!next.enabled || prev.enabled) return
      const s = useRadioStore.getState()
      if (!s.powered || !s.station) return
      // Reuse the current title immediately, then check the source without waiting
      // for the next poll. Keep replacement active through transient buffering.
      const title = currentSong(s)
      if (title) adReplacement.title(title)
      clearTimeout(this.timer)
      this.abort?.abort()
      void this.poll(s.station)
    })
    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (next.station !== prev.station || next.tuneStatus !== prev.tuneStatus || next.powered !== prev.powered) sync()
      if (next.nowPlaying !== prev.nowPlaying || next.station !== prev.station || next.powered !== prev.powered) this.updateMediaSession()
    })
    return () => {
      unsubscribe()
      unsubscribeAds()
      disconnectAds()
      this.stop()
      this.engine.onStreamTitle = null
    }
  }

  private stop() {
    clearTimeout(this.timer)
    this.abort?.abort()
    this.abort = null
    this.stationId = null
  }

  private async poll(station: Station) {
    const abort = new AbortController()
    this.abort = abort
    let title: string | null = null
    try {
      title = await this.lookup(station, abort.signal)
    } catch {
      // Every source is best effort
    }
    if (abort.signal.aborted || this.stationId !== station.id) return
    const s = useRadioStore.getState()
    if (title) adReplacement.title(title)
    if (title && title !== currentSong(s)) s.setNowPlaying({ stationId: station.id, title })
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    this.timer = setTimeout(() => void this.poll(station), hidden ? HIDDEN_POLL_MS : POLL_MS)
  }

  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    const res = await this.fetchImpl(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  async lookup(station: Station, signal: AbortSignal): Promise<string | null> {
    const channel = PARADISE_CHANNEL[station.id]
    if (channel !== undefined) {
      try {
        const rp = (await this.getJson(`https://api.radioparadise.com/api/now_playing?chan=${channel}`, signal)) as { artist?: unknown; title?: unknown }
        const title = cleanTitle(typeof rp.artist === 'string' && typeof rp.title === 'string' ? `${rp.artist} - ${rp.title}` : null)
        if (title) return title
      } catch {
        // Fall through to the stream's own metadata
      }
    }
    // HLS titles arrive from the player; there is no ICY stream to read
    if (isHls(station)) return null

    // A relayed station's own status page is plain http, which an HTTPS page can't read
    if (!station.relay && this.statusWorks.get(station.id) !== false) {
      try {
        const origin = new URL(station.url).origin
        const title = parseIcecastStatus(await this.getJson(`${origin}/status-json.xsl`, signal), station.url)
        this.statusWorks.set(station.id, true)
        if (title) return cleanTitle(title, station.name)
      } catch {
        if (signal.aborted) throw signal.reason
        this.statusWorks.set(station.id, false)
      }
    }

    if (this.presenceUrl) {
      const data = (await this.getJson(`${this.presenceUrl}/api/nowplaying?url=${encodeURIComponent(station.url)}`, signal)) as { title?: unknown }
      return cleanTitle(data.title, station.name)
    }
    return null
  }

  /** Lock screen / media keys show the song and station. */
  private updateMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
    const s = useRadioStore.getState()
    // Re-tuning clears the station for a moment; keep the lock screen steady until power-off
    if (!s.station) {
      if (!s.powered) navigator.mediaSession.metadata = null
      return
    }
    const song = currentSong(s)
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song ?? s.station.name,
      artist: song ? s.station.name : s.station.location,
      album: 'Pixel Radio',
      artwork: ARTWORK,
    })
  }
}

export const nowPlaying = new NowPlaying()
