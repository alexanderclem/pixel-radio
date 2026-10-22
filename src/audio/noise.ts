export type NoiseColor = 'white' | 'pink' | 'brown'

/** Stereo noise loop with decorrelated channels so it never sounds mono or phasey. */
export function createNoiseBuffer(ctx: BaseAudioContext, color: NoiseColor, seconds = 6): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const fade = Math.floor(ctx.sampleRate * 0.05)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const raw = generateNoise(color, length + fade)
    const data = buffer.getChannelData(ch)
    data.set(raw.subarray(0, length))
    // Blend the overshoot into the head: sample length-1 is then followed by a continuation of itself
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      data[i] = raw[i] * t + raw[length + i] * (1 - t)
    }
  }
  return buffer
}

function generateNoise(color: NoiseColor, length: number): Float32Array {
  const data = new Float32Array(length)
  if (color === 'white') {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  } else if (color === 'pink') {
    // Paul Kellet's refined pink filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    }
  } else {
    let last = 0
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      data[i] = last * 3.5
    }
  }
  return data
}

export type ImpulseStyle = 'crackle' | 'droplet' | 'vinyl'

interface ImpulseOptions {
  seconds: number
  /** Average events per second */
  density: number
  style: ImpulseStyle
}

/**
 * Sparse impulse loops: fire crackle (noise snaps), rain droplets (falling sine plinks)
 * and vinyl dust (tiny clicks). Rendered once, then looped by a BufferSource.
 */
export function createImpulseBuffer(ctx: BaseAudioContext, { seconds, density, style }: ImpulseOptions): AudioBuffer {
  const sr = ctx.sampleRate
  const length = Math.floor(sr * seconds)
  const buffer = ctx.createBuffer(2, length, sr)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  const events = Math.floor(seconds * density)

  for (let e = 0; e < events; e++) {
    const start = Math.floor(Math.random() * length)
    const pan = Math.random()
    const gl = Math.cos(pan * Math.PI * 0.5)
    const gr = Math.sin(pan * Math.PI * 0.5)

    if (style === 'droplet') {
      const dur = Math.floor(sr * (0.012 + Math.random() * 0.03))
      const f0 = 1800 + Math.random() * 3200
      const amp = 0.08 + Math.random() * 0.25
      let phase = 0
      for (let i = 0; i < dur; i++) {
        const t = i / dur
        const f = f0 * (1 - 0.55 * t)
        phase += (2 * Math.PI * f) / sr
        const s = Math.sin(phase) * Math.exp(-t * 6) * amp
        const idx = (start + i) % length
        left[idx] += s * gl
        right[idx] += s * gr
      }
    } else {
      // Loud pops are rare, small ticks are common
      const big = Math.random() < (style === 'crackle' ? 0.12 : 0.04)
      const dur = Math.floor(sr * (style === 'vinyl' ? 0.0015 : big ? 0.012 : 0.004) * (0.5 + Math.random()))
      const amp = (big ? 0.7 : 0.18) * (0.4 + Math.random() * 0.6) * (style === 'vinyl' ? 0.6 : 1)
      for (let i = 0; i < dur; i++) {
        const t = i / dur
        const s = (Math.random() * 2 - 1) * Math.exp(-t * 5) * amp
        const idx = (start + i) % length
        left[idx] += s * gl
        right[idx] += s * gr
      }
    }
  }
  return buffer
}

export function loopSource(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  return src
}
