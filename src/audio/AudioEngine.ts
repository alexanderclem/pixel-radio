import { CUTOFF_MAX, CUTOFF_MIN, TUNING } from '../constants/audio'
import type { AudioParams } from '../store/useRadioStore'
import type { AmbientChannelId, AmbientMix, PadMood, Station } from '../types'
import { clamp, taper } from '../utils/math'
import { AmbientChannels } from './AmbientChannels'
import { createImpulseBuffer, createNoiseBuffer, loopSource } from './noise'
import { PadSynth } from './PadSynth'
import { StaticGenerator } from './StaticGenerator'
import { StreamPlayer, type StreamEvent } from './StreamPlayer'

const AMBIENT_IDS: AmbientChannelId[] = ['rain', 'wind', 'city', 'fire']

interface Graph {
  ctx: AudioContext
  master: GainNode
  filter: BiquadFilterNode
  analyser: AnalyserNode
  analyserL: AnalyserNode
  analyserR: AnalyserNode
  padGain: GainNode
  hissGain: GainNode
  staticGain: GainNode
  streamGain: GainNode
  pad: PadSynth
  ambient: AmbientChannels
  staticGen: StaticGenerator
  stream: StreamPlayer
  white: AudioBuffer
}

/**
 * Owns the Web Audio graph:
 *
 *   pad ─┐
 *   rain/wind/city/fire ─┤
 *   static ─┤→ low-pass (FX cutoff) → master → analysers → destination
 *   hiss ─┤
 *   stream → panner ─┘
 */
class AudioEngine {
  private g: Graph | null = null
  private params: AudioParams | null = null
  private linked = true
  private spatial: AmbientMix = { rain: 0.25, wind: 0.5, city: 0.2, fire: 0.1 }
  private streamPresence = 1
  /** Stream level multiplier, lowered during focus breaks */
  private duck = 1
  onStreamEvent: ((event: StreamEvent) => void) | null = null
  private active = false
  private powerVersion = 0
  private levelBuf = new Float32Array(1024)

  get ready() {
    return this.g !== null
  }

  get analyser(): AnalyserNode | null {
    return this.g?.analyser ?? null
  }

  async init() {
    this.powerVersion++
    this.active = true
    if (this.g) {
      await this.g.ctx.resume()
      if (this.params) this.setParams(this.params, this.linked)
      return
    }
    const ctx = new AudioContext({ latencyHint: 'playback' })

    const white = createNoiseBuffer(ctx, 'white')
    const noise = { white, pink: createNoiseBuffer(ctx, 'pink'), brown: createNoiseBuffer(ctx, 'brown') }

    const master = ctx.createGain()
    master.gain.value = 0
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = CUTOFF_MAX
    filter.Q.value = 0.8

    // Gentle bus compression so stacked channels don't clip
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 3
    comp.attack.value = 0.01
    comp.release.value = 0.25

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.78
    const splitter = ctx.createChannelSplitter(2)
    const analyserL = ctx.createAnalyser()
    const analyserR = ctx.createAnalyser()
    analyserL.fftSize = analyserR.fftSize = 1024

    filter.connect(comp).connect(master)
    master.connect(ctx.destination)
    master.connect(analyser)
    master.connect(splitter)
    splitter.connect(analyserL, 0)
    splitter.connect(analyserR, 1)

    const bus = (src: AudioNode) => {
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(gain).connect(filter)
      return gain
    }

    const pad = new PadSynth(ctx)
    const ambient = new AmbientChannels(ctx, noise)
    ambient.output.connect(filter)
    const staticGen = new StaticGenerator(ctx, white)
    const stream = new StreamPlayer(ctx)
    stream.onEvent = (event) => this.onStreamEvent?.(event)

    // Tape hiss + vinyl dust
    const hissMix = ctx.createGain()
    const hissNoise = loopSource(ctx, white)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 3800
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 11000
    const hissLevel = ctx.createGain()
    hissLevel.gain.value = 0.12
    hissNoise.connect(hp).connect(lp).connect(hissLevel).connect(hissMix)
    const dust = loopSource(ctx, createImpulseBuffer(ctx, { seconds: 11, density: 9, style: 'vinyl' }))
    dust.connect(hissMix)

    this.g = {
      ctx, master, filter, analyser, analyserL, analyserR,
      padGain: bus(pad.output),
      hissGain: bus(hissMix),
      staticGain: bus(staticGen.output),
      streamGain: bus(stream.output),
      pad, ambient, staticGen, stream, white,
    }

    pad.start()
    ambient.start()
    staticGen.start()
    hissNoise.start(0, Math.random() * white.duration)
    dust.start()

    await ctx.resume()
    if (this.params) this.setParams(this.params, this.linked)
  }

  async suspend() {
    const version = ++this.powerVersion
    this.active = false
    if (!this.g) return
    this.g.stream.stop()
    this.g.staticGen.setScan(0)
    this.stopTuning()
    this.g.master.gain.setTargetAtTime(0, this.g.ctx.currentTime, 0.08)
    await new Promise((r) => setTimeout(r, 300))
    if (version === this.powerVersion) await this.g.ctx.suspend()
  }

  setParams(p: AudioParams, linked: boolean) {
    this.params = p
    this.linked = linked
    const g = this.g
    if (!g) return
    const now = g.ctx.currentTime
    g.master.gain.setTargetAtTime(this.active ? taper(p.master) : 0, now, 0.05)
    g.padGain.gain.setTargetAtTime(taper(p.pad) * 1.4, now, 0.1)
    g.hissGain.gain.setTargetAtTime(taper(p.hiss) * 1.5, now, 0.1)
    g.staticGain.gain.setTargetAtTime(1, now, 0.05)
    g.staticGen.setBed(taper(p.staticBlend) * 0.6)
    const hz = CUTOFF_MIN * Math.pow(CUTOFF_MAX / CUTOFF_MIN, p.cutoff)
    g.filter.frequency.setTargetAtTime(hz, now, 0.04)
    this.applyStream()
    this.applyAmbient()
  }

  /** Camera-driven ambient blend (0..1 per channel). */
  setSpatialMix(mix: AmbientMix) {
    this.spatial = mix
    this.applyAmbient()
  }

  /** Where the tuned city sits relative to the camera: pan -1..1, presence 0..1. */
  setStreamSpatial(pan: number, presence: number) {
    this.streamPresence = presence
    this.g?.stream.setPan(clamp(pan, -1, 1) * 0.8)
    this.applyStream()
  }

  private applyAmbient() {
    const g = this.g
    const p = this.params
    if (!g || !p) return
    for (const id of AMBIENT_IDS) {
      const geo = this.linked ? clamp(this.spatial[id] * 1.25, 0, 1) : 1
      g.ambient.setLevel(id, taper(p[id]) * geo * 0.9)
    }
  }

  private applyStream() {
    const g = this.g
    const p = this.params
    if (!g || !p) return
    const level = taper(p.stream) * (0.35 + 0.65 * this.streamPresence) * this.duck
    g.streamGain.gain.setTargetAtTime(level, g.ctx.currentTime, 0.12)
    // Unanalysed streams bypass the graph, so mirror master × stream onto the element
    g.stream.setDirectVolume(this.active ? taper(p.master) * level : 0)
  }

  /** Lower (or restore, with 1) the radio stream under the ambience. */
  setDuck(level: number) {
    this.duck = clamp(level, 0, 1)
    this.applyStream()
  }

  /** Soft two-partial bell for focus timer phase changes. */
  chime(high = false) {
    const g = this.g
    if (!g || !this.active) return
    const { ctx } = g
    const now = ctx.currentTime + 0.02
    const root = high ? 880 : 659.25
    for (const [ratio, level, decay] of [[1, 0.22, 1.6], [2.76, 0.06, 0.7]] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = root * ratio
      const env = ctx.createGain()
      env.gain.setValueAtTime(0, now)
      env.gain.linearRampToValueAtTime(level, now + 0.01)
      env.gain.setTargetAtTime(0, now + 0.02, decay / 4)
      // After the filter so a dark lo-pass setting can't swallow the alert
      osc.connect(env).connect(g.master)
      osc.start(now)
      osc.stop(now + decay * 1.5)
      osc.onended = () => env.disconnect()
    }
  }

  setMood(mood: PadMood) {
    this.g?.pad.setMood(mood)
  }

  startTuning() {
    this.g?.staticGen.startTuning()
  }

  stopTuning() {
    this.g?.staticGen.stopTuning(TUNING.fadeOutSeconds)
  }

  /** Static while the dial is dragged between stations (0..1). */
  setScanNoise(amount: number) {
    this.g?.staticGen.setScan(amount)
  }

  /** Resolves true if the stream runs through the graph (analysable). */
  async playStation(station: Station, timeoutMs = TUNING.streamTimeoutMs): Promise<boolean> {
    if (!this.g) throw new Error('audio engine not started')
    const analyzed = await this.g.stream.play(station, timeoutMs)
    this.applyStream()
    return analyzed
  }

  stopStream() {
    this.g?.stream.stop()
  }

  /** Distant thunder: brown-ish rumble with a slow decay, delayed after a flash. */
  thunder(intensity: number) {
    const g = this.g
    if (!g || !this.params) return
    const { ctx } = g
    const at = ctx.currentTime + 0.4 + Math.random() * 1.6
    const src = loopSource(ctx, g.white)
    src.loop = false
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(260 + Math.random() * 200, at)
    lp.frequency.exponentialRampToValueAtTime(70, at + 3)
    const env = ctx.createGain()
    const peak = 1.8 * intensity * taper(this.params.rain)
    env.gain.setValueAtTime(0, at)
    env.gain.linearRampToValueAtTime(peak, at + 0.08)
    env.gain.setTargetAtTime(peak * 0.4, at + 0.2, 0.25)
    env.gain.setTargetAtTime(0, at + 0.9, 0.9)
    src.connect(lp).connect(env).connect(g.filter)
    src.start(at)
    src.stop(at + 5)
    src.onended = () => env.disconnect()
  }

  /** RMS level per channel, 0..1-ish. */
  getLevels(): { left: number; right: number } {
    const g = this.g
    if (!g) return { left: 0, right: 0 }
    const rms = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(this.levelBuf)
      let sum = 0
      for (let i = 0; i < this.levelBuf.length; i++) sum += this.levelBuf[i] * this.levelBuf[i]
      return Math.sqrt(sum / this.levelBuf.length)
    }
    return { left: rms(g.analyserL), right: rms(g.analyserR) }
  }
}

export const audioEngine = new AudioEngine()
