/**
 * Which stations answered on this device: a small record of recent tuning attempts, kept
 * in its own localStorage key so it doesn't rewrite the settings on every tune.
 */
export interface Reliability {
  ok: number
  fail: number
  /** Last attempt, ms since epoch */
  at: number
  /** Whether the last attempt played */
  last: boolean
}

const KEY = 'pixel-radio.reliability'
const MAX = 500
/** Older outcomes stop counting against a station after this long */
const FORGET_MS = 14 * 24 * 3600 * 1000

let records: Map<string, Reliability> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function load(): Map<string, Reliability> {
  if (records) return records
  records = new Map()
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}')
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [id, r] of Object.entries(raw as Record<string, Partial<Reliability>>)) {
        if (typeof r?.ok === 'number' && typeof r.fail === 'number' && typeof r.at === 'number') {
          records.set(id, { ok: r.ok, fail: r.fail, at: r.at, last: r.last === true })
        }
      }
    }
  } catch {
    // Unreadable or blocked storage: start fresh
  }
  return records
}

function save() {
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(Object.fromEntries(load())))
    } catch {
      // Quota or privacy mode: it only lives for this visit
    }
  }, 2000)
}

/** Note whether a station played when we tried it. */
export function recordAttempt(id: string, played: boolean, now = Date.now()) {
  const map = load()
  const old = map.get(id)
  const fresh = old && now - old.at < FORGET_MS ? old : { ok: 0, fail: 0, at: now, last: played }
  map.delete(id)
  map.set(id, { ok: fresh.ok + Number(played), fail: fresh.fail + Number(!played), at: now, last: played })
  // Oldest first in a Map, so trimming drops the least recently tried
  while (map.size > MAX) map.delete(map.keys().next().value!)
  save()
}

export function reliabilityOf(id: string, now = Date.now()): Reliability | null {
  const r = load().get(id)
  return r && now - r.at < FORGET_MS ? r : null
}

/** Didn't answer the last time, and has failed more often than it played lately. */
export const oftenOffline = (r: Reliability | null) => !!r && !r.last && r.fail >= 2 && r.fail > r.ok

/** For tests: forget everything. */
export function resetReliability() {
  records = new Map()
}
