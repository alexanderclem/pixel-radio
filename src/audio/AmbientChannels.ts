import type { AmbientChannelId } from '../types'
import { createImpulseBuffer, loopSource } from './noise'

export interface NoiseBank {
  white: AudioBuffer
  pink: AudioBuffer
  brown: AudioBuffer
}

/**
 * Four procedural environment beds. Each channel exposes a gain the engine drives
 * from faders and the camera-position crossfade.
 */
export class AmbientChannels {
  readonly output: GainNode
  readonly channels: Record<AmbientChannelId, GainNode>
  private ctx: AudioContext
  private sources: AudioScheduledSourceNode[] = []

  constructor(ctx: AudioContext, noise: NoiseBank) {
    this.ctx = ctx
    this.output = ctx.createGain()
    const make = () => {
      const g = ctx.createGain()
      g.gain.value = 0
      g.connect(this.output)
      return g
    }
    this.channels = { rain: make(), wind: make(), city: make(), fire: make() }

    this.buildRain(noise)
    this.buildWind(noise)
    this.buildCity(noise)
    this.buildFire(noise)
  }

  private noise(buffer: AudioBuffer) {
    const src = loopSource(this.ctx, buffer)
    this.sources.push(src)
    return src
  }

  private osc(type: OscillatorType, freq: number) {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    this.sources.push(o)
    return o
  }

  private gain(value: number) {
    const g = this.ctx.createGain()
    g.gain.value = value
    return g
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7) {
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  /** LFO → depth gain → target param. */
  private modulate(target: AudioParam, rate: number, depth: number, type: OscillatorType = 'sine') {
    const lfo = this.osc(type, rate)
    const d = this.gain(depth)
    lfo.connect(d).connect(target)
  }

  private buildRain(noise: NoiseBank) {
    const out = this.channels.rain
    // Wash of rain on rooftops
    this.noise(noise.pink)
      .connect(this.filter('highpass', 500))
      .connect(this.filter('lowpass', 7500))
      .connect(this.gain(0.55))
      .connect(out)
    // Individual droplets close to the mic
    const drops = loopSource(this.ctx, createImpulseBuffer(this.ctx, { seconds: 7, density: 38, style: 'droplet' }))
    this.sources.push(drops)
    drops.connect(this.filter('highpass', 1200)).connect(this.gain(0.6)).connect(out)
    // Distant downpour rumble
    this.noise(noise.brown).connect(this.filter('lowpass', 220)).connect(this.gain(0.35)).connect(out)
  }

  private buildWind(noise: NoiseBank) {
    const out = this.channels.wind
    const body = this.filter('bandpass', 420, 0.9)
    const gust = this.gain(0.55)
    this.noise(noise.brown).connect(body).connect(gust).connect(out)
    this.modulate(body.frequency, 0.07, 260)
    this.modulate(gust.gain, 0.11, 0.4)
    // Whistling through gaps: narrow resonant band that drifts
    const whistle = this.filter('bandpass', 950, 14)
    const whistleAmp = this.gain(0.12)
    this.noise(noise.white).connect(whistle).connect(whistleAmp).connect(out)
    this.modulate(whistle.frequency, 0.045, 380)
    this.modulate(whistleAmp.gain, 0.09, 0.1)
  }

  private buildCity(noise: NoiseBank) {
    const out = this.channels.city
    // Mains hum and its harmonic
    this.osc('sawtooth', 60).connect(this.filter('lowpass', 190)).connect(this.gain(0.045)).connect(out)
    this.osc('sine', 120).connect(this.gain(0.025)).connect(out)
    // Traffic rumble that swells and recedes
    const traffic = this.gain(0.6)
    this.noise(noise.brown).connect(this.filter('lowpass', 380)).connect(traffic).connect(out)
    this.modulate(traffic.gain, 0.031, 0.3)
    // Far-off city air (HVAC, crowds) in the mids
    this.noise(noise.pink)
      .connect(this.filter('bandpass', 900, 0.5))
      .connect(this.gain(0.09))
      .connect(out)
  }

  private buildFire(noise: NoiseBank) {
    const out = this.channels.fire
    const roar = this.gain(0.45)
    this.noise(noise.brown).connect(this.filter('lowpass', 520)).connect(roar).connect(out)
    this.modulate(roar.gain, 0.23, 0.15)
    const crackle = loopSource(this.ctx, createImpulseBuffer(this.ctx, { seconds: 9, density: 22, style: 'crackle' }))
    this.sources.push(crackle)
    crackle.connect(this.filter('highpass', 900)).connect(this.gain(0.9)).connect(out)
  }

  start() {
    const now = this.ctx.currentTime
    for (const src of this.sources) {
      if (src instanceof AudioBufferSourceNode && src.buffer) {
        src.start(now, Math.random() * src.buffer.duration)
      } else {
        src.start(now)
      }
    }
  }

  setLevel(id: AmbientChannelId, value: number, timeConstant = 0.25) {
    this.channels[id].gain.setTargetAtTime(value, this.ctx.currentTime, timeConstant)
  }

  dispose() {
    const now = this.ctx.currentTime
    this.sources.forEach((s) => s.stop(now))
    this.output.disconnect()
  }
}
