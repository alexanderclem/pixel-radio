import { focusController, focusRemaining, isPaused } from '../focus/FocusController'
import { streak, week } from '../progress/progress'
import { captureSettings, sessionQuery } from '../session/setup'
import { currentSong, useRadioStore, type FocusSettings } from '../store/useRadioStore'
import type { Station } from '../types'
import { AccountSync } from './AccountSync'
import { resolveSharedStation } from './friendStation'
import { loadIdentity, loginAccount, logoutAccount, PRESENCE_URL, registerProfile, saveIdentity, signupAccount, type Identity } from './identity'
import {
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type FriendInfo,
  type Presence,
  type PublicWalker,
  type RoomAction,
  type RoomInfo,
  type ServerMessage,
  type SharedStation,
} from './protocol'
import { setRoomTimerSender } from './roomBridge'

type State = ReturnType<typeof useRadioStore.getState>

const HEARTBEAT_MS = 25_000
const STALE_MS = 65_000
const PUBLISH_DEBOUNCE_MS = 1000
const MAX_BACKOFF_MS = 30_000
const INVITE_KEY = 'pixel-radio.invite'
const ROOM_KEY = 'pixel-radio.room'
const MAX_ROOM_INVITES = 5

/** An invite link's code survives a reload until it's used (sessionStorage: this tab only). */
const pendingInvite = {
  get: () => {
    try {
      return globalThis.sessionStorage?.getItem(INVITE_KEY) ?? null
    } catch {
      return null
    }
  },
  set: (code: string | null) => {
    try {
      if (code) globalThis.sessionStorage?.setItem(INVITE_KEY, code)
      else globalThis.sessionStorage?.removeItem(INVITE_KEY)
    } catch {
      // No storage: the invite lasts until this page closes
    }
  },
}

/** A station as peers see it: display fields only, never the stream URL. */
export const sharedStationOf = (st: Station, song: string | null): SharedStation => ({
  id: st.id, name: st.name, song, location: st.location, country: st.country, lat: st.lat, lon: st.lon, curated: st.source === 'curated',
})

/** What friends get to see: display fields only, never the stream URL. */
export function presenceOf(s: State, now = Date.now()): Presence {
  const st: Station | null = s.social.shareListening && s.tuneStatus === 'playing' ? s.station : null
  return {
    avatar: s.avatar,
    station: st ? sharedStationOf(st, currentSong(s)) : null,
    stats: { streak: streak(s.progress), weekMinutes: Math.round(week(s.progress).minutes) },
    focus:
      s.focus.phase === 'idle'
        ? null
        : { phase: s.focus.phase, remainingMs: Math.round(focusRemaining(s.focus, now)), paused: isPaused(s.focus) },
  }
}

/** Changes worth telling friends about (the focus countdown itself is not one of them). */
const presenceKey = (s: State) =>
  JSON.stringify([
    s.avatar,
    s.social.shareListening && s.tuneStatus === 'playing' ? s.station?.id : null,
    s.social.shareListening ? currentSong(s) : null,
    s.focus.phase,
    s.focus.endsAt,
    s.focus.pausedRemaining,
    streak(s.progress),
    Math.round(week(s.progress).minutes),
  ])

/** The room survives a reload of this tab (sessionStorage), not a new tab. */
function readRoom() {
  try {
    return globalThis.sessionStorage?.getItem(ROOM_KEY) ?? null
  } catch {
    return null
  }
}
function writeRoom(code: string | null) {
  try {
    if (code) globalThis.sessionStorage?.setItem(ROOM_KEY, code)
    else globalThis.sessionStorage?.removeItem(ROOM_KEY)
  } catch {
    // No storage: the room lasts for this page
  }
}

const byPid = (list: PublicWalker[]) => Object.fromEntries(list.map((w) => [w.pid, w]))

const sortFriends = (list: FriendInfo[]) =>
  [...list].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))

interface Options {
  url?: string
  WebSocketImpl?: typeof WebSocket
  register?: typeof registerProfile
  sync?: (client: PresenceClient) => AccountSync
}

/**
 * Keeps one WebSocket to the presence Worker: says hello with this device's profile, or
 * connects as a guest without one. Mirrors the friend list and the public world into the
 * store, publishes our presence (debounced) and reconnects with backoff.
 */
export class PresenceClient {
  private url: string
  private WS: typeof WebSocket | undefined
  private register: typeof registerProfile
  private identity: Identity | null = null
  private ws: WebSocket | null = null
  private retries = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private publishTimer: ReturnType<typeof setTimeout> | undefined
  private lastMessage = 0
  private running = false
  private sync: AccountSync
  /** Friend code from an invite link, added as soon as we're connected */
  private invite: string | null = pendingInvite.get()
  /** The room to be in: rejoined after a reconnect, or joined from a link once signed in */
  private roomCode: string | null = readRoom()
  /** Your own timer settings, put back when you leave a study room */
  private soloSettings: FocusSettings | null = null
  /** The server predates guests (an older friends Worker): only signed-in connections */
  private guestsUnsupported = false

  constructor({ url = PRESENCE_URL, WebSocketImpl = globalThis.WebSocket, register = registerProfile, sync }: Options = {}) {
    this.url = url
    this.WS = WebSocketImpl
    this.register = register
    this.sync = sync ? sync(this) : new AccountSync({ url, identity: () => this.identity })
  }

  /** This device's profile, if any (an account when it has a username). */
  get current() {
    return this.identity
  }

  get configured() {
    return Boolean(this.url && this.WS)
  }

  connect() {
    this.running = true
    const store = useRadioStore.getState()
    if (!this.configured) {
      store.setFriends({ status: 'unconfigured' })
      return () => this.stop()
    }
    this.identity = loadIdentity()
    store.setFriends({ status: this.identity ? 'connecting' : 'signed-out', self: this.identity && this.selfOf(this.identity), invite: this.invite })
    this.open()
    const stopSync = this.sync.start()

    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (presenceKey(next) !== presenceKey(prev) || next.social.shareListening !== prev.social.shareListening) this.schedulePublish()
      if (next.social.appearOffline !== prev.social.appearOffline) this.send({ type: 'invisible', invisible: next.social.appearOffline })
      if (next.social.publicMode !== prev.social.publicMode) this.send({ type: 'world', mode: next.social.publicMode })
      // The host's station is the room's station
      const room = next.room
      if (room && room.host === next.friends.self?.userId && next.tuneStatus === 'playing' && next.station && next.station.id !== room.station?.id &&
        (next.station !== prev.station || next.tuneStatus !== prev.tuneStatus)) {
        this.shareRoomStation()
      }
    })
    setRoomTimerSender((action) => (useRadioStore.getState().room?.study ? this.send({ type: 'roomTimer', action }) : false))
    const wake = () => {
      if (document.visibilityState === 'visible' && !this.ws) this.reconnectNow()
    }
    const online = () => !this.ws && this.reconnectNow()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake)
    if (typeof window !== 'undefined') window.addEventListener('online', online)
    return () => {
      unsubscribe()
      stopSync()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake)
      if (typeof window !== 'undefined') window.removeEventListener('online', online)
      this.stop()
    }
  }

  private stop() {
    setRoomTimerSender(null)
    this.running = false
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.publishTimer)
    this.closeSocket()
  }

  private selfOf(identity: Identity) {
    return { userId: identity.userId, name: identity.name, code: identity.code, username: identity.username }
  }

  /** Switch to a profile (after signing in or up), reconnecting if its token changed. */
  private adopt(identity: Identity) {
    const reconnect = identity.token !== this.identity?.token
    saveIdentity(identity)
    this.identity = identity
    useRadioStore.getState().setFriends({ self: this.selfOf(identity), error: null })
    if (!reconnect) return
    // A different profile: leave the old one's room and reconnect as the new one
    this.roomCode = null
    writeRoom(null)
    this.leftRoom()
    if (this.ws) this.closeSocket()
    useRadioStore.getState().setFriends({ list: [], receivedAt: {} })
    this.retries = 0
    if (this.running) this.open()
  }

  /**
   * Make this device's profile an account (or a new profile, given a nickname), so it can
   * be signed in to elsewhere. Rejects with a message for the form.
   */
  async createAccount(fields: { username: string; password: string; name?: string }) {
    const identity = await signupAccount(this.url, fields, this.identity?.token ?? null)
    this.adopt(identity)
    await this.sync.begin(null)
  }

  /** Pull the account's latest copy and save anything pending. */
  syncNow() {
    return this.sync.pull()
  }

  /** Sign in to an account on this device; its friends, favorites and avatar come along. */
  async logIn(username: string, password: string) {
    const { identity, data, rev } = await loginAccount(this.url, username, password)
    this.adopt(identity)
    await this.sync.begin({ data, rev })
  }

  async signIn(name: string) {
    if (!this.configured) return
    const store = useRadioStore.getState()
    store.setFriends({ status: 'connecting', error: null })
    try {
      const identity = await this.register(this.url, name)
      saveIdentity(identity)
      this.identity = identity
      store.setFriends({ self: this.selfOf(identity) })
      this.retries = 0
      // An open guest connection becomes this profile's; otherwise connect
      if (this.ws?.readyState === 1) this.hello(this.ws)
      else if (this.running) this.open()
    } catch (err) {
      store.setFriends({ status: 'signed-out', error: err instanceof Error ? err.message : String(err) })
    }
  }

  /**
   * Forget this device's profile. For an account that just signs this device out; for a
   * device-only profile friends keep the old entry until they remove it.
   */
  async signOut() {
    const identity = this.identity
    if (identity?.username) {
      // Save any pending changes before this device loses access
      await this.sync.flush()
      void logoutAccount(this.url, identity.token)
    }
    if (this.identity !== identity) return
    this.sync.end()
    this.roomCode = null
    writeRoom(null)
    this.leftRoom()
    saveIdentity(null)
    this.identity = null
    clearTimeout(this.reconnectTimer)
    this.closeSocket()
    useRadioStore.getState().setFriends({ status: 'signed-out', self: null, list: [], error: null, receivedAt: {} })
    // Stay in the world as a guest
    if (this.running) this.open()
  }

  // --- Rooms ---

  createRoom(study: boolean) {
    const { work, short, long, longEvery } = useRadioStore.getState().focus.settings
    return this.send({ type: 'createRoom', study, settings: { work, short, long, longEvery } })
  }

  /** Join now when signed in and connected, otherwise as soon as that's true. */
  joinRoom(code: string) {
    this.roomCode = code
    writeRoom(code)
    const store = useRadioStore.getState()
    store.setRoomInvites(store.roomInvites.filter((i) => i.code !== code))
    if (store.friends.status === 'online') this.send({ type: 'joinRoom', code })
  }

  leaveRoom() {
    this.roomCode = null
    writeRoom(null)
    this.send({ type: 'leaveRoom' })
    this.leftRoom()
  }

  roomTimer(action: RoomAction) {
    return this.send({ type: 'roomTimer', action })
  }

  inviteToRoom(userId: string) {
    return this.send({ type: 'roomInvite', userId })
  }

  makeHost(userId: string) {
    return this.send({ type: 'roomHost', userId })
  }

  declineRoom(code: string) {
    const store = useRadioStore.getState()
    store.setRoomInvites(store.roomInvites.filter((i) => i.code !== code))
  }

  /** Host: the playing station (and your weather, sky and mix) become the room's. */
  shareRoomStation() {
    const s = useRadioStore.getState()
    if (!s.station || s.tuneStatus !== 'playing') return false
    return this.send({ type: 'roomStation', station: sharedStationOf(s.station, currentSong(s)), mood: sessionQuery(captureSettings(s)) })
  }

  private leftRoom() {
    const store = useRadioStore.getState()
    if (store.room?.study) {
      // Back to your own timer, idle, with your own lengths
      store.setFocus({ phase: 'idle', endsAt: null, pausedRemaining: null, longBreak: false })
      if (this.soloSettings) store.setFocusSettings(this.soloSettings)
    }
    this.soloSettings = null
    store.setRoom(null)
  }

  private applyRoom(room: RoomInfo) {
    const store = useRadioStore.getState()
    const prev = store.room
    const now = Date.now()
    if (room.study) {
      if (!this.soloSettings) this.soloSettings = store.focus.settings
      const t = room.timer
      const before = store.focus.phase
      store.setFocusSettings(room.settings)
      store.setFocus({
        phase: t.phase,
        endsAt: t.phase === 'idle' || t.paused ? null : now + t.remainingMs,
        pausedRemaining: t.phase !== 'idle' && t.paused ? t.remainingMs : null,
        longBreak: t.longBreak,
      })
      if (prev) focusController.roomPhase(before, t.phase, t.longBreak)
    }
    store.setRoom(room)
    const me = store.friends.self?.userId
    const action = room.lastAction
    if (prev && action && JSON.stringify(action) !== JSON.stringify(prev.lastAction) && action.name !== store.friends.self?.name) {
      const verb = { start: 'started the timer', pause: 'paused the timer', resume: 'resumed the timer', skip: 'skipped ahead', stop: 'stopped the timer', station: 'changed the station', host: 'handed over the host role' }[action.action]
      store.showToast(`${action.name} ${verb}`)
    }
    // Members tune along when the host changes station (not on every timer update)
    if (room.host !== me && store.social.followRoom && room.station && room.station.id !== prev?.station?.id && room.station.id !== store.station?.id && store.powered) {
      void resolveSharedStation(room.station).then((st) => {
        if (st) useRadioStore.getState().requestStation(st, true)
      })
    }
  }

  /** From an invite link: add now if connected, else right after connecting or signing up. */
  acceptInvite(code: string) {
    const store = useRadioStore.getState()
    if (store.friends.self?.code === code) return
    this.invite = code
    pendingInvite.set(code)
    store.setFriends({ invite: code })
    if (store.friends.status === 'online') this.sendInvite()
  }

  private sendInvite() {
    if (this.invite) this.send({ type: 'addFriend', code: this.invite })
  }

  private clearInvite() {
    this.invite = null
    pendingInvite.set(null)
    useRadioStore.getState().setFriends({ invite: null })
  }

  addFriend(code: string) {
    useRadioStore.getState().setFriends({ error: null })
    return this.send({ type: 'addFriend', code })
  }

  removeFriend(userId: string) {
    return this.send({ type: 'removeFriend', userId })
  }

  rename(name: string) {
    return this.send({ type: 'rename', name })
  }

  private send(msg: ClientMessage) {
    if (!this.ws || this.ws.readyState !== 1) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  private hello(ws: WebSocket) {
    const { social } = useRadioStore.getState()
    const msg: ClientMessage = this.identity
      ? { type: 'hello', token: this.identity.token, invisible: social.appearOffline, v: PROTOCOL_VERSION, public: social.publicMode }
      : { type: 'guest', v: PROTOCOL_VERSION, public: social.publicMode }
    ws.send(JSON.stringify(msg))
    // Guests get no welcome; publish straight away so they appear in the world
    if (!this.identity) this.publish()
  }

  private open() {
    if (!this.WS || this.ws || !this.configured) return
    if (!this.identity && this.guestsUnsupported) return
    clearTimeout(this.reconnectTimer)
    const ws = new this.WS(`${this.url.replace(/^http/, 'ws')}/api/ws`)
    this.ws = ws
    if (this.identity) useRadioStore.getState().setFriends({ status: 'connecting' })
    ws.onopen = () => {
      this.lastMessage = Date.now()
      this.hello(ws)
      clearInterval(this.heartbeat)
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage > STALE_MS) {
          // Half-open connection: drop it and let onclose reconnect
          ws.close()
          this.onClose(ws, 4000)
        } else {
          this.send({ type: 'ping' })
        }
      }, HEARTBEAT_MS)
    }
    ws.onmessage = (e) => {
      this.lastMessage = Date.now()
      const msg = parseServerMessage(e.data)
      if (msg) this.handle(msg)
    }
    ws.onclose = (e) => this.onClose(ws, e.code)
  }

  private closeSocket() {
    clearInterval(this.heartbeat)
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onclose = null
      ws.onmessage = null
      ws.close()
    }
  }

  private onClose(ws: WebSocket, code: number) {
    if (ws !== this.ws) return
    this.ws = null
    clearInterval(this.heartbeat)
    const store = useRadioStore.getState()
    store.setWorld({ synced: false })
    if (code === 4001 && this.identity) {
      // The server no longer knows this profile; carry on as a guest
      saveIdentity(null)
      this.identity = null
      this.sync.end()
      store.setFriends({ status: 'signed-out', self: null, list: [], receivedAt: {}, error: 'Your friends profile was not found. Pick a nickname to start again.' })
    } else if (this.identity) {
      store.setFriends({ status: 'offline' })
    }
    // Too many guest tabs on this network: don't keep knocking
    if (!this.running || code === 4002) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.retries) * (0.75 + Math.random() * 0.5)
    this.retries++
    this.reconnectTimer = setTimeout(() => this.open(), delay)
  }

  private reconnectNow() {
    this.retries = 0
    clearTimeout(this.reconnectTimer)
    this.open()
  }

  private schedulePublish() {
    clearTimeout(this.publishTimer)
    this.publishTimer = setTimeout(() => this.publish(), PUBLISH_DEBOUNCE_MS)
  }

  private publish() {
    clearTimeout(this.publishTimer)
    this.send({ type: 'presence', presence: presenceOf(useRadioStore.getState()) })
  }

  private handle(msg: ServerMessage) {
    const store = useRadioStore.getState()
    const now = Date.now()
    switch (msg.type) {
      case 'welcome':
        this.retries = 0
        if (this.identity && msg.self.username && this.identity.username !== msg.self.username) {
          this.identity = { ...this.identity, username: msg.self.username }
          saveIdentity(this.identity)
        }
        store.setFriends({
          serverVersion: msg.v,
          status: 'online',
          self: msg.self,
          list: sortFriends(msg.friends),
          error: null,
          receivedAt: Object.fromEntries(msg.friends.map((f) => [f.userId, now])),
        })
        this.publish()
        if (this.roomCode) this.send({ type: 'joinRoom', code: this.roomCode })
        if (this.invite === msg.self.code) this.clearInvite()
        else if (this.invite && msg.friends.some((f) => f.code === this.invite)) {
          store.showToast(`You're already friends with ${msg.friends.find((f) => f.code === this.invite)!.name}`)
          this.clearInvite()
        } else this.sendInvite()
        break
      case 'self':
        if (this.identity) {
          this.identity = { ...this.identity, name: msg.self.name }
          saveIdentity(this.identity)
        }
        store.setFriends({ self: msg.self })
        break
      case 'friend': {
        const { list, receivedAt } = store.friends
        store.setFriends({
          list: sortFriends([...list.filter((f) => f.userId !== msg.friend.userId), msg.friend]),
          receivedAt: { ...receivedAt, [msg.friend.userId]: now },
        })
        if (this.invite === msg.friend.code) {
          store.showToast(`You and ${msg.friend.name} are now friends`)
          this.clearInvite()
        }
        break
      }
      case 'friendRemoved':
        store.setFriends({ list: store.friends.list.filter((f) => f.userId !== msg.userId) })
        break
      case 'error':
        if (!this.identity && msg.reason === 'invalid' && !store.world.synced) {
          // An older server that doesn't know guests: stop quietly, and connect once signed in
          this.guestsUnsupported = true
          this.closeSocket()
          break
        }
        if (msg.reason !== 'auth') store.setFriends({ error: msg.message })
        // A bad invite won't get better by retrying it on every reconnect
        if (this.invite && ['not-found', 'self', 'limit'].includes(msg.reason)) this.clearInvite()
        break
      case 'pong':
        break
      case 'worldSnapshot':
        store.setWorld({ pid: msg.pid, walkers: byPid(msg.walkers), crowds: msg.crowds, online: msg.online, synced: true })
        break
      case 'room':
        this.roomCode = msg.room.code
        writeRoom(msg.room.code)
        this.applyRoom(msg.room)
        break
      case 'roomLeft':
        if (msg.reason !== 'left') store.showToast(msg.reason === 'full' ? 'That room is full' : 'That room has closed')
        this.roomCode = null
        writeRoom(null)
        this.leftRoom()
        break
      case 'roomInvited':
        if (store.room?.code === msg.code) break
        store.setRoomInvites([{ ...msg, at: now }, ...store.roomInvites.filter((i) => i.code !== msg.code)].slice(0, MAX_ROOM_INVITES))
        store.showToast(`${msg.from.name} invited you to a room${msg.station ? ` · ${msg.station.name}` : ''}`)
        break
      case 'worldDelta': {
        const walkers = { ...store.world.walkers, ...byPid(msg.upsert) }
        for (const pid of msg.remove) delete walkers[pid]
        store.setWorld({ walkers, crowds: msg.crowds, online: msg.online })
        break
      }
    }
  }
}

export const presenceClient = new PresenceClient()
