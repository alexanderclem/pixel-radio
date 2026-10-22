import { loopSource } from './noise'

/** Peak level of the station-switching hiss, before the mixer. */
const BURST_PEAK = 0.16
/** While a station keeps loading, the hiss settles to this fraction of the peak. */
const BURST_SETTLE = 0.45
const BAND_HZ = 1100

/**
 * Soft AM-radio tuning static: band-passed hiss with a gentle wobble, rolled off above
 * ~2 kHz, plus a faint whistle while the dial is dragged by hand. Has a constant "bed"
 * level (Static knob) and a burst envelope used while switching stations.
 */
export class StaticGenerator {
  readonly output: GainNode
  private ctx: AudioContext
  private band: BiquadFilterNode
  private chopRate: OscillatorNode
  private whistle: OscillatorNode
  private whistleAmp: GainNode
  private burst: GainNode
  private bed: GainNode
  private scan: GainNode
  private sources: AudioScheduledSourceNode[] = []

  constructor(ctx: AudioContext, white: AudioBuffer) {
    this.ctx = ctx
    this.output = ctx.createGain()

    const voice = ctx.createGain()

    const src = loopSource(ctx, white)
    this.band = ctx.createBiquadFilter()
    this.band.type = 'bandpass'
    this.band.frequency.value = BAND_HZ
    this.band.Q.value = 0.5

    // Slow sine wobble (between ~0.8 and 1) instead of a buzzing square chopper
    const chop = ctx.createGain()
    chop.gain.value = 0.9
    this.chopRate = ctx.createOscillator()
    this.chopRate.type = 'sine'
    this.chopRate.frequency.value = 3
    const chopDepth = ctx.createGain()
    chopDepth.gain.value = 0.1
    this.chopRate.connect(chopDepth).connect(chop.gain)

    src.connect(this.band).connect(chop).connect(voice)

    // Roll off the fizz so it reads as a distant hush rather than a hiss in your ear
    const soften = ctx.createBiquadFilter()
    soften.type = 'lowpass'
    soften.frequency.value = 2000
    soften.Q.value = 0.5

    this.whistle = ctx.createOscillator()
    this.whistle.type = 'sine'
    this.whistle.frequency.value = 900
    this.whistleAmp = ctx.createGain()
    this.whistleAmp.gain.value = 0
    this.whistle.connect(this.whistleAmp).connect(voice)

    this.burst = ctx.createGain()
    this.burst.gain.value = 0
    this.bed = ctx.createGain()
    this.bed.gain.value = 0
    this.scan = ctx.createGain()
    this.scan.gain.value = 0
    voice.connect(soften)
    soften.connect(this.burst).connect(this.output)
    soften.connect(this.bed).connect(this.output)
    soften.connect(this.scan).connect(this.output)

    this.sources.push(src, this.chopRate, this.whistle)
  }

  start() {
    const now = this.ctx.currentTime
    for (const s of this.sources) {
      if (s instanceof AudioBufferSourceNode && s.buffer) s.start(now, Math.random() * s.buffer.duration)
      else s.start(now)
    }
  }

  /** Constant background static (0..1 gain). */
  setBed(level: number) {
    this.bed.gain.setTargetAtTime(level, this.ctx.currentTime, 0.1)
  }

  /** Between-stations noise while the dial is dragged by hand (0..1). */
  setScan(amount: number) {
    const now = this.ctx.currentTime
    this.scan.gain.setTargetAtTime(amount * 0.22, now, 0.06)
    this.whistleAmp.gain.setTargetAtTime(amount * 0.008, now, 0.08)
    this.whistle.frequency.setTargetAtTime(300 + amount * 900, now, 0.08)
  }

  /**
   * Start a burst of tuning static: fade in, then settle lower while the station loads.
   * The band drifts slowly for a little movement; no whistles or stutter.
   */
  startTuning(seconds = 12) {
    const now = this.ctx.currentTime
    this.cancel(now)
    this.burst.gain.setTargetAtTime(BURST_PEAK, now, 0.12)
    this.burst.gain.setTargetAtTime(BURST_PEAK * BURST_SETTLE, now + 1.2, 1.5)
    this.whistleAmp.gain.setTargetAtTime(0, now, 0.05)

    let t = now
    while (t < now + seconds) {
      const step = 0.6 + Math.random() * 0.8
      this.band.frequency.setTargetAtTime(700 + Math.random() * 900, t, step / 3)
      this.chopRate.frequency.setTargetAtTime(1.5 + Math.random() * 3, t, step / 3)
      t += step
    }
  }

  /** Fade the burst away once a station locks in. */
  stopTuning(fadeSeconds = 0.7) {
    const now = this.ctx.currentTime
    this.cancel(now)
    this.burst.gain.setTargetAtTime(0, now, fadeSeconds / 3)
    this.whistleAmp.gain.setTargetAtTime(0, now, 0.05)
    this.band.frequency.setTargetAtTime(BAND_HZ, now, 0.2)
    this.chopRate.frequency.setTargetAtTime(3, now, 0.2)
  }

  private cancel(now: number) {
    for (const p of [this.burst.gain, this.band.frequency, this.chopRate.frequency, this.whistle.frequency, this.whistleAmp.gain]) {
      p.cancelScheduledValues(now)
      p.setValueAtTime(p.value, now)
    }
  }

  dispose() {
    const now = this.ctx.currentTime
    this.sources.forEach((s) => s.stop(now))
    this.output.disconnect()
  }
}
