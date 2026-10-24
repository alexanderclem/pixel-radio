import type { PadMood } from '../types'

/** Four-voice lo-fi voicings as MIDI notes; one chord every CHORD_SECONDS. */
export const CHORD_PROGRESSIONS: Record<PadMood, number[][]> = {
  // Cmaj7 – Am9 – Dm7 – G13
  warm: [[48, 55, 59, 64], [45, 55, 59, 64], [50, 57, 60, 65], [43, 53, 57, 64]],
  // Fmaj9 – Em7 – Dm9 – Cmaj9
  dreamy: [[41, 55, 57, 64], [40, 50, 55, 62], [38, 53, 57, 64], [36, 52, 55, 62]],
  // Am9 – Fmaj7#11 – Dm9 – E7b9
  noir: [[45, 55, 60, 71], [41, 52, 59, 64], [38, 53, 57, 64], [40, 50, 56, 65]],
  // Dmaj9 – Bm7 – Gmaj7 – A6
  bright: [[50, 57, 61, 64], [47, 54, 57, 62], [43, 54, 59, 62], [45, 52, 57, 66]],
}

export const CHORD_SECONDS = 7.5

export const PAD_CUTOFF: Record<PadMood, number> = {
  warm: 1400,
  dreamy: 1800,
  noir: 950,
  bright: 2400,
}

/** Filter knob maps 0..1 onto this log range (Hz). */
export const CUTOFF_MIN = 140
export const CUTOFF_MAX = 18000

export const TUNING = {
  /** Give up on a stream candidate after this long. */
  streamTimeoutMs: 6000,
  /** Maximum ordinary candidates before moving on to curated fallbacks. */
  maxAttempts: 3,
  primaryBudgetMs: 12000,
  fallbackBudgetMs: 9000,
  maxRecoveries: 2,
  stablePlaybackMs: 30000,
  fadeOutSeconds: 0.7,
  /**
   * Starting audio waits this long for the browser. Without a click it can wait forever
   * (scheduled moods, media keys), which would leave the power button stuck.
   */
  audioStartMs: 6000,
}
