import { focusRemaining, isPaused } from '../focus/FocusController'
import { currentSong, useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { loadIdentity, PRESENCE_URL, registerProfile, saveIdentity, type Identity } from './identity'
import { parseServerMessage, PROTOCOL_VERSION, type ClientMessage, type FriendInfo, type Presence, type PublicWalker, type ServerMessage } from './protocol'

type State = ReturnType<typeof useRadioStore.getState>

const HEARTBEAT_MS = 25_000
const STALE_MS = 65_000
const PUBLISH_DEBOUNCE_MS = 1000
const MAX_BACKOFF_MS = 30_000
const INVITE_KEY = 'pixel-radio.invite'

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

/** What friends get to see: display fields only, never the stream URL. */
export function presenceOf(s: State, now = Date.now()): Presence {
  const st: Station | null = s.social.shareListening && s.tuneStatus === 'playing' ? s.station : null
  return {
    avatar: s.avatar,
    station: st
      ? {
          id: st.id, name: st.name, song: currentSong(s), location: st.location, country: st.country,
          lat: st.lat, lon: st.lon, curated: st.source === 'curated',
        }
      : null,
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
  ])

const byPid = (list: PublicWalker[]) => Object.fromEntries(list.map((w) => [w.pid, w]))

const sortFriends = (list: FriendInfo[]) =>
  [...list].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))

interface Options {
  url?: string
  WebSocketImpl?: typeof WebSocket
  register?: typeof registerProfile
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
  /** Friend code from an invite link, added as soon as we're connected */
  private invite: string | null = pendingInvite.get()

  constructor({ url = PRESENCE_URL, WebSocketImpl = globalThis.WebSocket, register = registerProfile }: Options = {}) {
    this.url = url
    this.WS = WebSocketImpl
    this.register = register
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

    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (presenceKey(next) !== presenceKey(prev) || next.social.shareListening !== prev.social.shareListening) this.schedulePublish()
      if (next.social.appearOffline !== prev.social.appearOffline) this.send({ type: 'invisible', invisible: next.social.appearOffline })
      if (next.social.publicMode !== prev.social.publicMode) this.send({ type: 'world', mode: next.social.publicMode })
    })
    const wake = () => {
      if (document.visibilityState === 'visible' && !this.ws) this.reconnectNow()
    }
    const online = () => !this.ws && this.reconnectNow()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake)
    if (typeof window !== 'undefined') window.addEventListener('online', online)
    return () => {
      unsubscribe()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake)
      if (typeof window !== 'undefined') window.removeEventListener('online', online)
      this.stop()
    }
  }

  private stop() {
    this.running = false
    clearTimeout(this.reconnectTimer)
    clearTimeout(this.publishTimer)
    this.closeSocket()
  }

  private selfOf(identity: Identity) {
    return { userId: identity.userId, name: identity.name, code: identity.code }
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

  /** Forget this device's profile (friends keep the old entry until they remove it). */
  signOut() {
    saveIdentity(null)
    this.identity = null
    clearTimeout(this.reconnectTimer)
    this.closeSocket()
    useRadioStore.getState().setFriends({ status: 'signed-out', self: null, list: [], error: null, receivedAt: {} })
    // Stay in the world as a guest
    if (this.running) this.open()
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
        store.setFriends({
          status: 'online',
          self: msg.self,
          list: sortFriends(msg.friends),
          error: null,
          receivedAt: Object.fromEntries(msg.friends.map((f) => [f.userId, now])),
        })
        this.publish()
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
        if (msg.reason !== 'auth') store.setFriends({ error: msg.message })
        // A bad invite won't get better by retrying it on every reconnect
        if (this.invite && ['not-found', 'self', 'limit'].includes(msg.reason)) this.clearInvite()
        break
      case 'pong':
        break
      case 'worldSnapshot':
        store.setWorld({ pid: msg.pid, walkers: byPid(msg.walkers), crowds: msg.crowds, online: msg.online, synced: true })
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
