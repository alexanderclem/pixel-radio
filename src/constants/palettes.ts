import type { SolarPhase } from '../types'
import { hexToRgb, lerp, mixRGB, type RGB } from '../utils/math'

/** Terrain materials, in the order the renderer indexes them. */
export const MATERIALS = [
  'deep', 'ocean', 'shallow', 'foam', 'beach', 'grass', 'forest', 'jungle',
  'desert', 'steppe', 'tundra', 'ice', 'rock', 'peak', 'urban',
] as const
export type Material = (typeof MATERIALS)[number]

type ColorKeys =
  | Material
  | 'bg' | 'cloud' | 'shadowTint' | 'highlight' | 'shade' | 'cityLight' | 'glow' | 'label' | 'grid' | 'border'
  | 'station' | 'rain' | 'snowfall' | 'ember' | 'star' | 'auroraA' | 'auroraB'

export type Palette = Record<ColorKeys, RGB> & {
  /** How strongly the night side darkens (0..1) */
  nightStrength: number
  /** Cloud opacity over the surface (0..1) */
  cloudAlpha: number
  /** Star field visibility (0..1) */
  stars: number
  /** Aurora ribbon visibility (0..1) */
  aurora: number
}

const make = (colors: Record<ColorKeys, string>, n: Omit<Palette, ColorKeys>): Palette =>
  ({ ...Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, hexToRgb(v)])), ...n }) as Palette

export const PALETTES: Record<SolarPhase, Palette> = {
  day: make(
    {
      deep: '#17306e', ocean: '#1f4f9c', shallow: '#2f7fc4', foam: '#9fe0ff', beach: '#ecd592',
      grass: '#67b33e', forest: '#2e7d3c', jungle: '#1d6a43', desert: '#e3b268', steppe: '#b9b45c',
      tundra: '#8f9d7c', ice: '#eaf4f8', rock: '#8b7b6c', peak: '#ffffff', urban: '#a59aa6',
      bg: '#0b1a2e', cloud: '#f5f8ff', shadowTint: '#1d1650', highlight: '#fff4b8', shade: '#0b1238',
      cityLight: '#ffe08a', glow: '#ffe66d', label: '#ffffff', grid: '#9fd8ff', border: '#fff6d8', station: '#ffd166',
      rain: '#bfe4ff', snowfall: '#ffffff', ember: '#ffb347', star: '#ffffff', auroraA: '#7cff9e', auroraB: '#6a8bff',
    },
    { nightStrength: 0.74, cloudAlpha: 0.82, stars: 0, aurora: 0 },
  ),
  golden: make(
    {
      deep: '#291d57', ocean: '#43357c', shallow: '#7d4c8f', foam: '#ffb892', beach: '#ffc47e',
      grass: '#c28c3e', forest: '#7c4b2d', jungle: '#6b412c', desert: '#ffa257', steppe: '#d99b4d',
      tundra: '#a97c6b', ice: '#ffdac6', rock: '#8c5c5c', peak: '#ffe9d9', urban: '#a8767c',
      bg: '#1a0f24', cloud: '#ffcfa8', shadowTint: '#2c0f3c', highlight: '#fff2a6', shade: '#1c0b2e',
      cityLight: '#ffd36b', glow: '#ffcf5c', label: '#fff1d6', grid: '#ffb38a', border: '#ffe6c2', station: '#ffe08a',
      rain: '#ffd2b0', snowfall: '#fff0e0', ember: '#ff8a3d', star: '#ffe9c4', auroraA: '#ffb36b', auroraB: '#ff5f9e',
    },
    { nightStrength: 0.62, cloudAlpha: 0.7, stars: 0.25, aurora: 0 },
  ),
  night: make(
    {
      deep: '#04050f', ocean: '#080b24', shallow: '#10214d', foam: '#2f6bff', beach: '#ff2e88',
      grass: '#29225f', forest: '#1d184b', jungle: '#181546', desert: '#3d2262', steppe: '#312c60',
      tundra: '#293262', ice: '#4b5a92', rock: '#35295c', peak: '#6c7cba', urban: '#3e3374',
      bg: '#030308', cloud: '#1d2250', shadowTint: '#000012', highlight: '#7df9ff', shade: '#000000',
      cityLight: '#00f0ff', glow: '#00f0ff', label: '#7df9ff', grid: '#ff2e88', border: '#c86bff', station: '#ff5fb0',
      rain: '#5fd7ff', snowfall: '#b8c8ff', ember: '#ff2e88', star: '#cfe8ff', auroraA: '#00f0ff', auroraB: '#b04dff',
    },
    { nightStrength: 0.35, cloudAlpha: 0.4, stars: 1, aurora: 0.15 },
  ),
  aurora: make(
    {
      deep: '#020a12', ocean: '#05182a', shallow: '#0b3443', foam: '#3dffb0', beach: '#2fd99a',
      grass: '#134041', forest: '#0e3134', jungle: '#0b2a2e', desert: '#27354d', steppe: '#1b4545',
      tundra: '#1d4b4b', ice: '#3b7b77', rock: '#21363b', peak: '#5ba89d', urban: '#2a4550',
      bg: '#01060a', cloud: '#12313b', shadowTint: '#000508', highlight: '#9dffd8', shade: '#00040a',
      cityLight: '#9dffcf', glow: '#7cff9e', label: '#c8ffe6', grid: '#3dffb0', border: '#7cffc4', station: '#b9ff6b',
      rain: '#8affd8', snowfall: '#e0fff6', ember: '#7cff9e', star: '#e8fff8', auroraA: '#3dffb0', auroraB: '#b04dff',
    },
    { nightStrength: 0.3, cloudAlpha: 0.35, stars: 1, aurora: 1 },
  ),
}

export const PHASE_LABEL: Record<SolarPhase, string> = {
  day: 'DAY',
  golden: 'GOLDEN HR',
  night: 'CYBER-NIGHT',
  aurora: 'AURORA',
}

export const blendPalette = (a: Palette, b: Palette, t: number): Palette => {
  const out = {} as Record<string, RGB | number>
  for (const key of Object.keys(a) as (keyof Palette)[]) {
    const av = a[key]
    const bv = b[key]
    out[key] = typeof av === 'number' ? lerp(av, bv as number, t) : mixRGB(av, bv as RGB, t)
  }
  return out as unknown as Palette
}

export const TONES = 3

/**
 * Flat colour table indexed by material * 3 + tone (0 shadow, 1 base, 2 lit).
 * Shadows shift toward the palette's cool tint and highlights toward its warm one,
 * the classic pixel-art ramp instead of plain darken/lighten.
 */
export function buildMaterialTable(p: Palette): Uint8Array {
  const table = new Uint8Array(MATERIALS.length * TONES * 3)
  MATERIALS.forEach((m, i) => {
    const base = p[m]
    const tones = [mixRGB(base, p.shadowTint, 0.38), base, mixRGB(base, p.highlight, 0.24)]
    tones.forEach((c, t) => table.set([c[0], c[1], c[2]], (i * TONES + t) * 3))
  })
  return table
}
