import type Hls from 'hls.js'
import type { ErrorData, Events, FragParsingMetadataData } from 'hls.js'
import { parseId3Title } from '../nowplaying/parse'
import type { Station } from '../types'

export class StreamCancelled extends Error {
  constructor() {
    super('cancelled')
  }
}

export class PlaybackBlocked extends Error {
  constructor() {
    super('Press retry to allow audio playback')
  }
}

export type StreamEvent = { station: Station } & (
  | { type: 'playing' | 'buffering' }
  | { type: 'error'; error: Error }
)

interface Attempt {
  audio: HTMLAudioElement
  source: MediaElementAudioSourceNode | null
  hls: Hls | null
  cancel: () => void
}

/** Keep lifecycle listeners alive until teardown, including after the first playing event. */
export class StreamPlayer {
  readonly output: GainNode
  onEvent: ((event: StreamEvent) => void) | null = null
  /** Song titles found in the stream itself (HLS ID3 timed metadata) */
  onTitle: ((station: Station, title: string) => void) | null = null
  private ctx: AudioContext
  private panner: StereoPannerNode
  private current: Attempt | null = null
  private token = 0
  private directVolume = 0
  private stallTimeoutMs: number

  constructor(ctx: AudioContext, stallTimeoutMs = 10000) {
    this.ctx = ctx
    this.stallTimeoutMs = stallTimeoutMs
    this.panner = ctx.createStereoPanner()
    this.output = ctx.createGain()
    this.panner.connect(this.output)
  }

  async play(station: Station, timeoutMs: number): Promise<boolean> {
    const token = ++this.token
    this.teardown()
    const deadline = performance.now() + timeoutMs
    try {
      await this.attempt(station, true, timeoutMs * 0.65, token)
      if (token !== this.token) throw new StreamCancelled()
      if (!this.current) throw new Error('Stream disconnected during startup')
      return true
    } catch (err) {
      if (err instanceof StreamCancelled || err instanceof PlaybackBlocked) throw err
      const isHls = station.hls || /\.m3u8(?:\?|$)/i.test(station.url)
      // hls.js fetches segments itself and cannot use a no-CORS fallback.
      if (isHls && !new Audio().canPlayType('application/vnd.apple.mpegurl')) throw err
      if (token !== this.token) throw new StreamCancelled()
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw err
      await this.attempt(station, false, remaining, token)
      if (token !== this.token) throw new StreamCancelled()
      if (!this.current) throw new Error('Stream disconnected during startup')
      return false
    }
  }

  private async attempt(station: Station, cors: boolean, timeoutMs: number, token: number) {
    this.teardown()
    const audio = new Audio()
    audio.preload = 'none'
    if (cors) audio.crossOrigin = 'anonymous'
    else audio.volume = this.directVolume
    const attempt: Attempt = { audio, source: null, hls: null, cancel: () => {} }
    this.current = attempt

    // Install cancellation and the deadline before loading HLS, which is asynchronous.
    await new Promise<void>((resolve, reject) => {
      let started = false
      let finished = false
      let settled = false
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      let HlsCtor: typeof Hls | null = null
      const active = () => this.current === attempt && token === this.token && !finished
      const clearStall = () => {
        clearTimeout(stallTimer)
        stallTimer = undefined
      }
      const cleanup = () => {
        clearTimeout(startTimer)
        clearStall()
        audio.removeEventListener('playing', onPlaying)
        audio.removeEventListener('waiting', onBuffering)
        audio.removeEventListener('stalled', onBuffering)
        audio.removeEventListener('timeupdate', onProgress)
        audio.removeEventListener('error', onError)
        audio.removeEventListener('ended', onEnded)
        if (HlsCtor) attempt.hls?.off(HlsCtor.Events.ERROR, onHlsError)
      }
      const fail = (error: Error) => {
        if (!active()) return
        finished = true
        cleanup()
        if (!settled) {
          settled = true
          reject(error)
        }
        this.teardown()
        if (started) this.onEvent?.({ type: 'error', station, error })
      }
      const onPlaying = () => {
        if (!active()) return
        started = true
        clearTimeout(startTimer)
        clearStall()
        if (!settled) {
          settled = true
          resolve()
        }
        this.onEvent?.({ type: 'playing', station })
      }
      const onBuffering = () => {
        if (!active() || !started || stallTimer !== undefined) return
        this.onEvent?.({ type: 'buffering', station })
        stallTimer = setTimeout(() => fail(new Error('Stream stalled')), this.stallTimeoutMs)
      }
      let lastTime = 0
      const onProgress = () => {
        // Some browsers resume time updates without another playing event.
        if (audio.currentTime > lastTime && stallTimer !== undefined) onPlaying()
        lastTime = audio.currentTime
      }
      const onError = () => fail(new Error(audio.error?.message || 'Stream disconnected'))
      const onEnded = () => fail(new Error('Stream ended'))
      const onHlsError = (_: Events.ERROR, data: ErrorData) => {
        if (data.fatal) fail(new Error(data.details))
      }
      const onHlsMetadata = (_: Events.FRAG_PARSING_METADATA, data: FragParsingMetadataData) => {
        for (const sample of data.samples) {
          const title = sample.data ? parseId3Title(sample.data) : null
          if (title && active()) this.onTitle?.(station, title)
        }
      }
      const startTimer = setTimeout(() => fail(new Error('Stream timed out')), timeoutMs)
      attempt.cancel = () => {
        finished = true
        cleanup()
        if (!settled) {
          settled = true
          reject(new StreamCancelled())
        }
      }
      audio.addEventListener('playing', onPlaying)
      audio.addEventListener('waiting', onBuffering)
      audio.addEventListener('stalled', onBuffering)
      audio.addEventListener('timeupdate', onProgress)
      audio.addEventListener('error', onError)
      audio.addEventListener('ended', onEnded)

      const load = async () => {
        if (cors) {
          attempt.source = this.ctx.createMediaElementSource(audio)
          attempt.source.connect(this.panner)
        }
        const isHls = station.hls || /\.m3u8(?:\?|$)/i.test(station.url)
        if (isHls && !audio.canPlayType('application/vnd.apple.mpegurl')) {
          HlsCtor = (await import('hls.js')).default
          if (!active()) return
          if (!HlsCtor.isSupported()) throw new Error('HLS unsupported')
          attempt.hls = new HlsCtor({ lowLatencyMode: false, maxBufferLength: 20 })
          attempt.hls.on(HlsCtor.Events.ERROR, onHlsError)
          attempt.hls.on(HlsCtor.Events.FRAG_PARSING_METADATA, onHlsMetadata)
          attempt.hls.loadSource(station.url)
          attempt.hls.attachMedia(audio)
        } else {
          audio.src = station.url
        }
        if (active()) await audio.play()
      }
      void load().catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err))
        fail(error.name === 'NotAllowedError' ? new PlaybackBlocked() : error)
      })
    })
  }

  setPan(pan: number) {
    this.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, 0.15)
  }

  /** Always retain the actual master × stream volume for a future direct fallback. */
  setDirectVolume(volume: number) {
    this.directVolume = Math.min(1, Math.max(0, volume))
    const a = this.current
    if (a && !a.source) a.audio.volume = this.directVolume
  }

  stop() {
    this.token++
    this.teardown()
  }

  private teardown() {
    const a = this.current
    if (!a) return
    this.current = null
    a.cancel()
    a.hls?.destroy()
    a.audio.pause()
    a.audio.removeAttribute('src')
    a.audio.load()
    a.source?.disconnect()
  }
}
