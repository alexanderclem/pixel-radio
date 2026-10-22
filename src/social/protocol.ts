import { AVATAR_SLOTS, PART_COUNTS, type Avatar } from '../avatar/parts'

/**
 * Wire protocol shared by the browser client and the presence Worker. Everything a
 * peer sends is display data: stations travel as ids plus labels, never stream URLs.
 */

/** Bumped when the server starts sending frames older clients can't use; they keep getting the old set. */
export const PROTOCOL_VERSION = 2

export const LIMITS = {
  nameLength: 24,
  stationText: 80,
  frameBytes: 2048,
  maxFriends: 100,
  /** Longest focus/break phase we relay, in ms */
  maxPhaseMs: 6 * 60 * 60 * 1000,
} as const

export interface SharedStation {
  id: string
  name: string
  /** Song the station is announcing right now */
  song: string | null
  location: string
  country: string
  lat: number | null
  lon: number | null
  curated: boolean
}

export interface FocusStatus {
  phase: 'focus' | 'break'
  /** Time left in the phase when the message was sent */
  remainingMs: number
  paused: boolean
}

export interface Presence {
  station: SharedStation | null
  focus: FocusStatus | null
  avatar: Avatar | null
}

export interface SelfInfo {
  userId: string
  name: string
  code: string
}

export interface FriendInfo extends SelfInfo {
  online: boolean
  presence: Presence | null
}

export type ClientMessage =
  | { type: 'hello'; token: string; invisible: boolean; v: number }
  | { type: 'presence'; presence: Presence }
  | { type: 'invisible'; invisible: boolean }
  | { type: 'addFriend'; code: string }
  | { type: 'removeFriend'; userId: string }
  | { type: 'rename'; name: string }
  | { type: 'ping' }

export type ErrorReason = 'auth' | 'invalid' | 'not-found' | 'self' | 'limit' | 'rate'

export type ServerMessage =
  | { type: 'welcome'; v: number; self: SelfInfo; friends: FriendInfo[] }
  | { type: 'self'; self: SelfInfo }
  | { type: 'friend'; friend: FriendInfo }
  | { type: 'friendRemoved'; userId: string }
  | { type: 'error'; reason: ErrorReason; message: string }
  | { type: 'pong' }

export interface RegisterResponse extends SelfInfo {
  token: string
}

// --- Friend codes: 8 Crockford base32 characters, shown as PR-XXXX-XXXX ---

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateCode(random: (count: number) => ArrayLike<number> = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(8), (b) => CROCKFORD[b & 31]).join('')
}

/** Accepts "pr-7k3q-9xzt", "7K3Q 9XZT", and Crockford look-alikes (O→0, I/L→1). */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.toUpperCase().replace(/^\s*PR[-\s]*/, '').replace(/[-\s]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(raw) ? raw : null
}

export const formatCode = (code: string) => `PR-${code.slice(0, 4)}-${code.slice(4)}`

/** Study-room codes: 4 Crockford characters, shown as ROOM-XXXX. Same look-alike rules as friend codes. */
export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.toUpperCase().replace(/^\s*ROOM[-\s]*/, '').replace(/[-\s]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{4}$/.test(raw) ? raw : null
}

/** Trim, collapse whitespace and strip control characters; null when nothing usable remains. */
export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const name = input.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, '').replace(/\s+/g, ' ').trim()
  return name ? [...name].slice(0, LIMITS.nameLength).join('') : null
}

// --- Validation of untrusted frames ---

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number) => (typeof v === 'string' ? [...v.replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '')
const coord = (v: unknown, limit: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit ? v : null)
export const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)
/** Peers that predate versioning send no version: they speak 1. */
const version = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1000 ? v : 1)

export function sanitizeStation(v: unknown): SharedStation | null {
  if (!isObject(v) || !isId(v.id)) return null
  const name = text(v.name, LIMITS.stationText)
  if (!name) return null
  const lat = coord(v.lat, 90)
  const lon = coord(v.lon, 180)
  const song = text(v.song, 120)
  return {
    id: v.id,
    name,
    song: song || null,
    location: text(v.location, LIMITS.stationText),
    country: /^[A-Za-z]{2}$/.test(String(v.country)) ? String(v.country).toUpperCase() : '',
    lat: lat !== null && lon !== null ? lat : null,
    lon: lat !== null && lon !== null ? lon : null,
    curated: v.curated === true,
  }
}

export function sanitizeFocus(v: unknown): FocusStatus | null {
  if (!isObject(v) || (v.phase !== 'focus' && v.phase !== 'break')) return null
  const remaining = typeof v.remainingMs === 'number' && Number.isFinite(v.remainingMs) ? v.remainingMs : 0
  return { phase: v.phase, remainingMs: Math.round(Math.min(LIMITS.maxPhaseMs, Math.max(0, remaining))), paused: v.paused === true }
}

/**
 * Every slot must be a part index. A part we don't know yet (added by a newer client)
 * becomes that slot's first part; anything malformed drops the whole avatar.
 */
export function sanitizeAvatar(v: unknown): Avatar | null {
  if (!isObject(v)) return null
  const out: Partial<Avatar> = {}
  for (const slot of AVATAR_SLOTS) {
    const n = v[slot]
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null
    out[slot] = n < PART_COUNTS[slot] ? n : 0
  }
  return out as Avatar
}

export function sanitizePresence(v: unknown): Presence {
  return isObject(v)
    ? { station: sanitizeStation(v.station), focus: sanitizeFocus(v.focus), avatar: sanitizeAvatar(v.avatar) }
    : { station: null, focus: null, avatar: null }
}

/** Parses a client frame; null for anything malformed or oversized. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== 'string' || raw.length > LIMITS.frameBytes) return null
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(msg)) return null
  switch (msg.type) {
    case 'hello':
      return typeof msg.token === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(msg.token)
        ? { type: 'hello', token: msg.token, invisible: msg.invisible === true, v: version(msg.v) }
        : null
    case 'presence':
      return { type: 'presence', presence: sanitizePresence(msg.presence) }
    case 'invisible':
      return { type: 'invisible', invisible: msg.invisible === true }
    case 'addFriend': {
      const code = normalizeCode(msg.code)
      return code ? { type: 'addFriend', code } : null
    }
    case 'removeFriend':
      return isId(msg.userId) ? { type: 'removeFriend', userId: msg.userId } : null
    case 'rename': {
      const name = normalizeName(msg.name)
      return name ? { type: 'rename', name } : null
    }
    case 'ping':
      return { type: 'ping' }
    default:
      return null
  }
}

function sanitizeSelf(v: unknown): SelfInfo | null {
  if (!isObject(v) || !isId(v.userId)) return null
  const name = normalizeName(v.name)
  const code = normalizeCode(v.code)
  return name && code ? { userId: v.userId, name, code } : null
}

function sanitizeFriend(v: unknown): FriendInfo | null {
  const self = sanitizeSelf(v)
  if (!self || !isObject(v)) return null
  const online = v.online === true
  return { ...self, online, presence: online && v.presence ? sanitizePresence(v.presence) : null }
}

/** The client re-validates server frames too, so a bad deploy can't break the UI. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(msg)) return null
  switch (msg.type) {
    case 'welcome': {
      const self = sanitizeSelf(msg.self)
      if (!self || !Array.isArray(msg.friends)) return null
      return { type: 'welcome', v: version(msg.v), self, friends: msg.friends.map(sanitizeFriend).filter((f): f is FriendInfo => f !== null) }
    }
    case 'self': {
      const self = sanitizeSelf(msg.self)
      return self ? { type: 'self', self } : null
    }
    case 'friend': {
      const friend = sanitizeFriend(msg.friend)
      return friend ? { type: 'friend', friend } : null
    }
    case 'friendRemoved':
      return isId(msg.userId) ? { type: 'friendRemoved', userId: msg.userId } : null
    case 'error': {
      const reasons: ErrorReason[] = ['auth', 'invalid', 'not-found', 'self', 'limit', 'rate']
      const reason = reasons.find((r) => r === msg.reason) ?? 'invalid'
      return { type: 'error', reason, message: text(msg.message, 160) }
    }
    case 'pong':
      return { type: 'pong' }
    default:
      return null
  }
}
