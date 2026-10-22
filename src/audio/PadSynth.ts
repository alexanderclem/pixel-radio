import { CHORD_PROGRESSIONS, CHORD_SECONDS, PAD_CUTOFF } from '../constants/audio'
import type { PadMood } from '../types'
import { midiToHz } from '../utils/math'

const VOICE_LEVEL = 0.07
const LOOKAHEAD_S = 0.6

interface Voice {
  oscs: OscillatorNode[]
  amp: GainNode
}

/** Soft tape-style saturation curve. */
function makeSaturationCurve(amount: number) {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  return curve
}

/**
 * Lo-fi chord pad: four voices of detuned saw + triangle through a breathing low-pass,
 * with tape wow & flutter LFOs wobbling every oscillator's detune.
 */
export class PadSynth {
  readonly output: GainNode
  private ctx: AudioContext
  private voices: Voice[] = []
  private filter: BiquadFilterNode
  private lfos: OscillatorNode[] = []
  private mood: PadMood = 'warm'
  private chordIndex = 0
  private nextChordTime = 0
  private timer: number | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.output = ctx.createGain()

    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = PAD_CUTOFF.warm
    this.filter.Q.value = 0.9

    const shaper = ctx.createWaveShaper()
    shaper.curve = makeSaturationCurve(1.6)
    shaper.oversample = '2x'

    this.filter.connect(shaper).connect(this.output)

    const wow = this.makeLfo(0.33, 9)
    const flutter = this.makeLfo(5.7, 2.5)
    const sweep = this.makeLfo(0.06, 450)
    sweep.connect(this.filter.frequency)

    const chord = CHORD_PROGRESSIONS.warm[0]
    chord.forEach((note, v) => {
      const amp = ctx.createGain()
      amp.gain.value = 0
      const pan = ctx.createStereoPanner()
      pan.pan.value = (v / (chord.length - 1)) * 1.2 - 0.6
      amp.connect(pan).connect(this.filter)

      const oscs = (['sawtooth', 'triangle'] as OscillatorType[]).map((type, i) => {
        const osc = ctx.createOscillator()
        osc.type = type
        osc.frequency.value = midiToHz(note)
        osc.detune.value = (i === 0 ? -7 : 7) + (Math.random() - 0.5) * 4
        wow.connect(osc.detune)
        flutter.connect(osc.detune)
        osc.connect(amp)
        return osc
      })
      this.voices.push({ oscs, amp })
    })
  }

  /** LFO oscillator routed through a depth gain; returns the depth node to connect from. */
  private makeLfo(rate: number, depth: number): GainNode {
    const lfo = this.ctx.createOscillator()
    lfo.frequency.value = rate * (0.9 + Math.random() * 0.2)
    const gain = this.ctx.createGain()
    gain.gain.value = depth
    lfo.connect(gain)
    this.lfos.push(lfo)
    return gain
  }

  start() {
    const now = this.ctx.currentTime
    for (const v of this.voices) v.oscs.forEach((o) => o.start(now))
    this.lfos.forEach((l) => l.start(now))
    this.nextChordTime = now + 0.05
    this.timer = window.setInterval(() => this.schedule(), 200)
    this.schedule()
  }

  setMood(mood: PadMood) {
    if (mood === this.mood) return
    this.mood = mood
    this.chordIndex = 0
    this.filter.frequency.setTargetAtTime(PAD_CUTOFF[mood], this.ctx.currentTime, 1.5)
    // Re-voice on the next scheduler tick instead of waiting out the current chord
    this.nextChordTime = this.ctx.currentTime + 0.3
  }

  private schedule() {
    while (this.nextChordTime < this.ctx.currentTime + LOOKAHEAD_S) {
      const progression = CHORD_PROGRESSIONS[this.mood]
      const chord = progression[this.chordIndex % progression.length]
      const t = this.nextChordTime
      this.voices.forEach((voice, v) => {
        const hz = midiToHz(chord[v])
        // Slight per-voice strum and portamento glide
        const at = t + v * 0.06
        for (const osc of voice.oscs) osc.frequency.setTargetAtTime(hz, at, 0.12)
        voice.amp.gain.cancelScheduledValues(at)
        voice.amp.gain.setTargetAtTime(VOICE_LEVEL * 0.35, at, 0.25)
        voice.amp.gain.setTargetAtTime(VOICE_LEVEL * (0.8 + Math.random() * 0.4), at + 0.35, 1.4)
      })
      this.chordIndex++
      this.nextChordTime += CHORD_SECONDS
    }
  }

  dispose() {
    if (this.timer !== null) window.clearInterval(this.timer)
    const now = this.ctx.currentTime
    for (const v of this.voices) v.oscs.forEach((o) => o.stop(now))
    this.lfos.forEach((l) => l.stop(now))
    this.output.disconnect()
  }
}
