import { loopSource } from './noise'

/**
 * AM-radio tuning static: band-passed hiss chopped by a square LFO, plus a heterodyne
 * whistle that sweeps while the dial moves. Has a constant "bed" level (Static Blend knob)
 * and a burst envelope used while switching stations.
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
    this.band.frequency.value = 2200
    this.band.Q.value = 0.6

    // Chopper: square LFO amplitude-modulates the hiss between ~0.25 and 1
    const chop = ctx.createGain()
    chop.gain.value = 0.62
    this.chopRate = ctx.createOscillator()
    this.chopRate.type = 'square'
    this.chopRate.frequency.value = 13
    const chopDepth = ctx.createGain()
    chopDepth.gain.value = 0.38
    this.chopRate.connect(chopDepth).connect(chop.gain)

    src.connect(this.band).connect(chop).connect(voice)

    // Broadband crunch underneath so it isn't only a band of noise
    const crunch = ctx.createGain()
    crunch.gain.value = 0.18
    const crunchSrc = loopSource(ctx, white)
    crunchSrc.connect(crunch).connect(voice)

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
    voice.connect(this.burst).connect(this.output)
    voice.connect(this.bed).connect(this.output)
    voice.connect(this.scan).connect(this.output)

    this.sources.push(src, crunchSrc, this.chopRate, this.whistle)
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
    this.scan.gain.setTargetAtTime(amount * 0.8, now, 0.04)
    this.whistleAmp.gain.setTargetAtTime(amount * 0.05, now, 0.05)
    this.whistle.frequency.setTargetAtTime(400 + amount * 2600, now, 0.05)
  }

  /** Start a burst of tuning static; random squiggles are scheduled ahead for `seconds`. */
  startTuning(seconds = 12) {
    const now = this.ctx.currentTime
    this.cancel(now)
    this.burst.gain.setTargetAtTime(0.9, now, 0.015)

    let t = now
    while (t < now + seconds) {
      const step = 0.05 + Math.random() * 0.25
      this.band.frequency.setValueAtTime(500 + Math.random() * 4200, t)
      this.chopRate.frequency.setValueAtTime(6 + Math.random() * 40, t)
      // Occasional heterodyne whistle sweeps as carriers slide past
      if (Math.random() < 0.35) {
        const from = 200 + Math.random() * 2500
        this.whistle.frequency.setValueAtTime(from, t)
        this.whistle.frequency.exponentialRampToValueAtTime(Math.max(80, from * (0.3 + Math.random() * 2)), t + step)
        this.whistleAmp.gain.setValueAtTime(0.04 + Math.random() * 0.05, t)
        this.whistleAmp.gain.setTargetAtTime(0, t + step * 0.7, 0.03)
      }
      t += step
    }
  }

  /** Fade the burst away once a station locks in. */
  stopTuning(fadeSeconds = 0.7) {
    const now = this.ctx.currentTime
    this.cancel(now)
    this.burst.gain.setTargetAtTime(0, now, fadeSeconds / 3)
    this.whistleAmp.gain.setTargetAtTime(0, now, 0.05)
    this.band.frequency.setTargetAtTime(2200, now, 0.2)
    this.chopRate.frequency.setTargetAtTime(13, now, 0.2)
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
