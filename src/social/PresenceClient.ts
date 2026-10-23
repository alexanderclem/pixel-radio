import { focusRemaining, isPaused } from '../focus/FocusController'
import { currentSong, useRadioStore } from '../store/useRadioStore'
import type { Station } from '../types'
import { AccountSync } from './AccountSync'
import { loadIdentity, loginAccount, logoutAccount, PRESENCE_URL, registerProfile, saveIdentity, signupAccount, type Identity } from './identity'
import { parseServerMessage, type ClientMessage, type FriendInfo, type Presence, type ServerMessage } from './protocol'

type State = ReturnType<typeof useRadioStore.getState>

const HEARTBEAT_MS = 25_000
const STALE_MS = 65_000
const PUBLISH_DEBOUNCE_MS = 1000
const MAX_BACKOFF_MS = 30_000

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

const sortFriends = (list: FriendInfo[]) =>
  [...list].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))

interface Options {
  url?: string
  WebSocketImpl?: typeof WebSocket
  register?: typeof registerProfile
  sync?: (client: PresenceClient) => AccountSync
}

/**
 * Keeps one WebSocket to the presence Worker while a profile exists: says hello,
 * mirrors the friend list into the store, publishes our presence (debounced) and
 * reconnects with backoff.
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
    store.setFriends({ status: this.identity ? 'connecting' : 'signed-out', self: this.identity && this.selfOf(this.identity) })
    if (this.identity) this.open()
    const stopSync = this.sync.start()

    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (presenceKey(next) !== presenceKey(prev) || next.social.shareListening !== prev.social.shareListening) this.schedulePublish()
      if (next.social.appearOffline !== prev.social.appearOffline) this.send({ type: 'invisible', invisible: next.social.appearOffline })
    })
    const wake = () => {
      if (document.visibilityState === 'visible' && this.identity && !this.ws) this.reconnectNow()
    }
    const online = () => this.identity && !this.ws && this.reconnectNow()
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
      if (this.running) this.open()
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
    saveIdentity(null)
    this.identity = null
    clearTimeout(this.reconnectTimer)
    this.closeSocket()
    useRadioStore.getState().setFriends({ status: 'signed-out', self: null, list: [], error: null, receivedAt: {} })
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

  private open() {
    if (!this.WS || !this.identity || this.ws) return
    clearTimeout(this.reconnectTimer)
    const ws = new this.WS(`${this.url.replace(/^http/, 'ws')}/api/ws`)
    this.ws = ws
    useRadioStore.getState().setFriends({ status: 'connecting' })
    ws.onopen = () => {
      this.lastMessage = Date.now()
      ws.send(JSON.stringify({ type: 'hello', token: this.identity!.token, invisible: useRadioStore.getState().social.appearOffline }))
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
    if (code === 4001) {
      // The server no longer knows this profile (or this device was signed out)
      saveIdentity(null)
      this.identity = null
      this.sync.end()
      store.setFriends({ status: 'signed-out', self: null, list: [], receivedAt: {}, error: 'Your friends profile was not found. Pick a nickname to start again.' })
      return
    }
    store.setFriends({ status: 'offline' })
    if (!this.running || !this.identity) return
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
          status: 'online',
          self: msg.self,
          list: sortFriends(msg.friends),
          error: null,
          receivedAt: Object.fromEntries(msg.friends.map((f) => [f.userId, now])),
        })
        this.publish()
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
        break
      }
      case 'friendRemoved':
        store.setFriends({ list: store.friends.list.filter((f) => f.userId !== msg.userId) })
        break
      case 'error':
        if (msg.reason !== 'auth') store.setFriends({ error: msg.message })
        break
      case 'pong':
        break
    }
  }
}

export const presenceClient = new PresenceClient()
