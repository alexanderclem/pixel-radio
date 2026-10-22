export type RGB = [number, number, number]

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Frame-rate independent exponential approach toward `target`. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt))

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

export const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
]

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`

/** Small deterministic PRNG so terrain and star fields are stable across reloads. */
export const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

export const midiToHz = (note: number) => 440 * Math.pow(2, (note - 69) / 12)

/** Perceptual taper for 0..1 controls. */
export const taper = (v: number) => v * v

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
