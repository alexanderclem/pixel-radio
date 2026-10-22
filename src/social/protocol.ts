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
  /** Public walkers sent to everyone; the rest are only counted */
  maxWalkers: 300,
  /** Walkers shown per station before the rest join its crowd count */
  walkersPerStation: 8,
  /** Stations listed with their listener counts */
  maxCrowds: 50,
  roomMembers: 12,
  /** A shared mood (a session query string) */
  moodLength: 300,
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

/** A little progress friends can see */
export interface ProgressStats {
  /** Days in a row with a finished focus session */
  streak: number
  /** Focus minutes this week */
  weekMinutes: number
}

export interface Presence {
  station: SharedStation | null
  focus: FocusStatus | null
  avatar: Avatar | null
  /** Older clients send none */
  stats?: ProgressStats | null
}

export interface SelfInfo {
  userId: string
  name: string
  code: string
}

export interface FriendInfo extends SelfInfo {
  online: boolean
  presence: Presence | null
  /** Their public-world id, so the map can draw them once, as a friend */
  pid: string | null
}

/** How strangers see you in the public world. */
export type PublicMode = 'anonymous' | 'named' | 'hidden'
export const PUBLIC_MODES: PublicMode[] = ['anonymous', 'named', 'hidden']

/** Someone in the public world. `pid` is random per connection: never a user id or friend code. */
export interface PublicWalker {
  pid: string
  /** Only when they chose to be named */
  name: string | null
  avatar: Avatar
  station: { id: string; name: string; song: string | null; location: string; lat: number; lon: number }
  focus: FocusStatus['phase'] | null
}

/** Listeners at one station, counting those not sent as walkers. */
export interface Crowd {
  stationId: string
  name: string
  location: string
  lat: number
  lon: number
  count: number
}

/** Focus timer lengths in minutes; every Nth focus earns a long break. */
export interface RoomSettings {
  work: number
  short: number
  long: number
  longEvery: number
}

export type RoomAction = 'start' | 'pause' | 'resume' | 'skip' | 'stop'
export const ROOM_ACTIONS: RoomAction[] = ['start', 'pause', 'resume', 'skip', 'stop']

export interface RoomMember {
  userId: string
  name: string
  avatar: Avatar
  /** Listening to the room's station right now */
  here: boolean
}

/** A listening room as members see it. Timer deadlines travel as time left. */
export interface RoomInfo {
  code: string
  /** userId of the host, who chooses the station */
  host: string
  /** A study room runs the shared focus timer */
  study: boolean
  members: RoomMember[]
  timer: { phase: 'idle' | 'focus' | 'break'; remainingMs: number; paused: boolean; cycle: number; longBreak: boolean }
  settings: RoomSettings
  station: SharedStation | null
  /** The host's mood as a session query (weather, sky, mix), for members to match */
  mood: string | null
  lastAction: { name: string; action: RoomAction | 'station' | 'host' } | null
}

export type ClientMessage =
  | { type: 'hello'; token: string; invisible: boolean; v: number; public: PublicMode }
  /** Connect without a profile: watch the world, and walk in it anonymously */
  | { type: 'guest'; v: number; public: PublicMode }
  | { type: 'world'; mode: PublicMode }
  | { type: 'presence'; presence: Presence }
  | { type: 'invisible'; invisible: boolean }
  | { type: 'addFriend'; code: string }
  | { type: 'removeFriend'; userId: string }
  | { type: 'rename'; name: string }
  | { type: 'ping' }
  | { type: 'createRoom'; study: boolean; settings: RoomSettings }
  | { type: 'joinRoom'; code: string }
  | { type: 'leaveRoom' }
  | { type: 'roomTimer'; action: RoomAction }
  /** Host only */
  | { type: 'roomStation'; station: SharedStation | null; mood: string | null }
  /** Host only: invite a friend */
  | { type: 'roomInvite'; userId: string }
  /** Host only: hand the host role to another member */
  | { type: 'roomHost'; userId: string }

export type ErrorReason = 'auth' | 'invalid' | 'not-found' | 'self' | 'limit' | 'rate'

export type ServerMessage =
  | { type: 'welcome'; v: number; self: SelfInfo; friends: FriendInfo[] }
  | { type: 'self'; self: SelfInfo }
  | { type: 'friend'; friend: FriendInfo }
  | { type: 'friendRemoved'; userId: string }
  | { type: 'error'; reason: ErrorReason; message: string }
  | { type: 'pong' }
  /** `pid` is your own, so you aren't drawn twice */
  | { type: 'worldSnapshot'; pid: string; walkers: PublicWalker[]; crowds: Crowd[]; online: number }
  | { type: 'worldDelta'; upsert: PublicWalker[]; remove: string[]; crowds: Crowd[]; online: number }
  | { type: 'room'; room: RoomInfo }
  | { type: 'roomLeft'; reason: 'left' | 'full' | 'not-found' }
  | { type: 'roomInvited'; code: string; from: { userId: string; name: string }; station: SharedStation | null }

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

/** Roots of words a public nickname may not contain (after undoing common letter swaps). */
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'kike', 'whore', 'slut', 'retard']
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' }

/** A nickname as strangers may see it; null (shown as "listener") when it trips the word list. */
export function publicName(name: string): string | null {
  const clean = normalizeName(name)
  if (!clean) return null
  const flat = [...clean.toLowerCase()].map((c) => LEET[c] ?? c).join('').replace(/[^a-z]/g, '')
  return BLOCKED.some((word) => flat.includes(word)) ? null : clean
}

// --- Validation of untrusted frames ---

const minutes = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null)

export function sanitizeRoomSettings(v: unknown): RoomSettings | null {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  const work = minutes(r.work, 180)
  const short = minutes(r.short, 60)
  const long = minutes(r.long, 90)
  const longEvery = minutes(r.longEvery, 12)
  return work && short && long && longEvery ? { work, short, long, longEvery } : null
}

/** A session query string, bounded; the client parses it with its own rules before using it. */
const sanitizeMood = (v: unknown) =>
  typeof v === 'string' && v.length <= LIMITS.moodLength && /^[A-Za-z0-9=&.,%_-]*$/.test(v) && v ? v : null

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number) => (typeof v === 'string' ? [...v.replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '')
const coord = (v: unknown, limit: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= limit ? v : null)
export const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)
export const isPid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,24}$/.test(v)
/** Clients from before the public world never send a mode; they stay out of it. */
const publicMode = (v: unknown): PublicMode => (PUBLIC_MODES.includes(v as PublicMode) ? (v as PublicMode) : 'hidden')
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

export function sanitizeStats(v: unknown): ProgressStats | null {
  if (!isObject(v)) return null
  const n = (x: unknown, max: number) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? Math.min(max, x) : 0)
  return { streak: n(v.streak, 3650), weekMinutes: n(v.weekMinutes, 7 * 24 * 60) }
}

export function sanitizePresence(v: unknown): Presence {
  return isObject(v)
    ? { station: sanitizeStation(v.station), focus: sanitizeFocus(v.focus), avatar: sanitizeAvatar(v.avatar), stats: sanitizeStats(v.stats) }
    : { station: null, focus: null, avatar: null, stats: null }
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
        ? { type: 'hello', token: msg.token, invisible: msg.invisible === true, v: version(msg.v), public: publicMode(msg.public) }
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
    case 'guest': {
      // Guests have no name to show
      const mode = publicMode(msg.public)
      return { type: 'guest', v: version(msg.v), public: mode === 'named' ? 'anonymous' : mode }
    }
    case 'world':
      return PUBLIC_MODES.includes(msg.mode as PublicMode) ? { type: 'world', mode: msg.mode as PublicMode } : null
    case 'createRoom': {
      const settings = sanitizeRoomSettings(msg.settings)
      return settings ? { type: 'createRoom', study: msg.study === true, settings } : null
    }
    case 'joinRoom': {
      const code = normalizeRoomCode(msg.code)
      return code ? { type: 'joinRoom', code } : null
    }
    case 'leaveRoom':
      return { type: 'leaveRoom' }
    case 'roomTimer':
      return ROOM_ACTIONS.includes(msg.action as RoomAction) ? { type: 'roomTimer', action: msg.action as RoomAction } : null
    case 'roomStation':
      return { type: 'roomStation', station: sanitizeStation(msg.station), mood: sanitizeMood(msg.mood) }
    case 'roomInvite':
      return isId(msg.userId) ? { type: 'roomInvite', userId: msg.userId } : null
    case 'roomHost':
      return isId(msg.userId) ? { type: 'roomHost', userId: msg.userId } : null
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
  return { ...self, online, presence: online && v.presence ? sanitizePresence(v.presence) : null, pid: online && isPid(v.pid) ? v.pid : null }
}

const placed = (v: Record<string, unknown>) => {
  const lat = coord(v.lat, 90)
  const lon = coord(v.lon, 180)
  return lat !== null && lon !== null ? { lat, lon } : null
}

export function sanitizeWalker(v: unknown): PublicWalker | null {
  if (!isObject(v) || !isPid(v.pid) || !isObject(v.station) || !isId(v.station.id)) return null
  const avatar = sanitizeAvatar(v.avatar)
  const where = placed(v.station)
  const name = text(v.station.name, LIMITS.stationText)
  if (!avatar || !where || !name) return null
  return {
    pid: v.pid,
    name: v.name === null || v.name === undefined ? null : normalizeName(v.name),
    avatar,
    station: { id: v.station.id, name, song: text(v.station.song, 120) || null, location: text(v.station.location, LIMITS.stationText), ...where },
    focus: v.focus === 'focus' || v.focus === 'break' ? v.focus : null,
  }
}

function sanitizeCrowd(v: unknown): Crowd | null {
  if (!isObject(v) || !isId(v.stationId)) return null
  const where = placed(v)
  const name = text(v.name, LIMITS.stationText)
  const count = typeof v.count === 'number' && Number.isInteger(v.count) && v.count > 0 ? v.count : 0
  return where && name && count ? { stationId: v.stationId, name, location: text(v.location, LIMITS.stationText), ...where, count } : null
}

const list = <T>(v: unknown, clean: (x: unknown) => T | null, max: number): T[] =>
  Array.isArray(v) ? v.slice(0, max).map(clean).filter((x): x is T => x !== null) : []
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0)

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
    case 'worldSnapshot':
      if (!isPid(msg.pid)) return null
      return {
        type: 'worldSnapshot',
        pid: msg.pid,
        walkers: list(msg.walkers, sanitizeWalker, LIMITS.maxWalkers),
        crowds: list(msg.crowds, sanitizeCrowd, LIMITS.maxCrowds),
        online: count(msg.online),
      }
    case 'worldDelta':
      return {
        type: 'worldDelta',
        upsert: list(msg.upsert, sanitizeWalker, LIMITS.maxWalkers),
        remove: list(msg.remove, (x) => (isPid(x) ? x : null), 5000),
        crowds: list(msg.crowds, sanitizeCrowd, LIMITS.maxCrowds),
        online: count(msg.online),
      }
    case 'room': {
      const room = sanitizeRoom(msg.room)
      return room ? { type: 'room', room } : null
    }
    case 'roomLeft': {
      const reasons = ['left', 'full', 'not-found'] as const
      return { type: 'roomLeft', reason: reasons.find((r) => r === msg.reason) ?? 'left' }
    }
    case 'roomInvited': {
      const code = normalizeRoomCode(msg.code)
      const from = isObject(msg.from) && isId(msg.from.userId) ? { userId: msg.from.userId, name: normalizeName(msg.from.name) ?? 'A friend' } : null
      return code && from ? { type: 'roomInvited', code, from, station: sanitizeStation(msg.station) } : null
    }
    default:
      return null
  }
}

function sanitizeRoom(v: unknown): RoomInfo | null {
  if (!isObject(v) || !isId(v.host)) return null
  const code = normalizeRoomCode(v.code)
  const settings = sanitizeRoomSettings(v.settings)
  if (!code || !settings || !isObject(v.timer) || !Array.isArray(v.members)) return null
  const t = v.timer
  const phase = t.phase === 'focus' || t.phase === 'break' ? t.phase : 'idle'
  const remaining = typeof t.remainingMs === 'number' && Number.isFinite(t.remainingMs) ? Math.min(LIMITS.maxPhaseMs, Math.max(0, t.remainingMs)) : 0
  const members = v.members.slice(0, LIMITS.roomMembers).flatMap((m: unknown) => {
    if (!isObject(m) || !isId(m.userId)) return []
    const avatar = sanitizeAvatar(m.avatar)
    const name = normalizeName(m.name)
    return avatar && name ? [{ userId: m.userId, name, avatar, here: m.here === true }] : []
  })
  const actions = [...ROOM_ACTIONS, 'station', 'host'] as const
  const last = isObject(v.lastAction) ? v.lastAction : null
  const lastAction = last && actions.includes(last.action as (typeof actions)[number])
    ? { name: normalizeName(last.name) ?? 'Someone', action: last.action as (typeof actions)[number] }
    : null
  return {
    code,
    host: v.host,
    study: v.study === true,
    members,
    timer: { phase, remainingMs: Math.round(remaining), paused: t.paused === true, cycle: count(t.cycle), longBreak: t.longBreak === true },
    settings,
    station: sanitizeStation(v.station),
    mood: sanitizeMood(v.mood),
    lastAction,
  }
}
