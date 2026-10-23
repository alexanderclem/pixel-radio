export const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
export const station = (id, patch = {}) => ({
  id, name: id, url: `https://example.test/${id}`, hls: false,
  source: 'radio-browser', codec: 'MP3', bitrate: 128, country: 'JP',
  state: '', location: 'Japan', homepage: '', tags: '', popularity: 0,
  lat: null, lon: null, approx: false, ...patch,
})
export const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
export class FakeAudio extends EventTarget {
  static instances = []
  static behavior = () => Promise.resolve()
  volume = 1
  currentTime = 0
  listeners = new Map()
  constructor() { super(); FakeAudio.instances.push(this) }
  addEventListener(type, fn, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(fn)
    super.addEventListener(type, fn, options)
  }
  removeEventListener(type, fn, options) {
    this.listeners.get(type)?.delete(fn)
    super.removeEventListener(type, fn, options)
  }
  emit(type) { this.dispatchEvent(new Event(type)) }
  play() { return FakeAudio.behavior(this) }
  pause() { this.paused = true }
  load() {}
  removeAttribute() {}
  canPlayType() { return '' }
}
export function fakeContext() {
  const node = () => ({ connect() {}, disconnect() {}, pan: { setTargetAtTime() {} } })
  return { createGain: node, createStereoPanner: node, createMediaElementSource: node }
}

/** In-memory stand-in for the Worker's SQLite repo. */
export class MemoryRepo {
  users = new Map()
  friends = new Map()
  accounts = new Map()
  tokens = new Map()
  createUser(u) { this.users.set(u.id, { ...u }) }
  userById(id) { return this.users.get(id) ?? null }
  userByCode(code) { return [...this.users.values()].find((u) => u.code === code) ?? null }
  userByTokenHash(hash) {
    const device = this.tokens.get(hash)
    return device ? this.userById(device) : [...this.users.values()].find((u) => u.tokenHash === hash) ?? null
  }
  addToken(userId, hash) { this.tokens.set(hash, userId) }
  deleteToken(hash) { this.tokens.delete(hash) }
  createAccount(a) {
    if (this.accountByUsername(a.username)) throw new Error('UNIQUE constraint failed')
    this.accounts.set(a.userId, { ...a })
  }
  accountOf(userId) { return this.accounts.get(userId) ?? null }
  accountByUsername(username) { return [...this.accounts.values()].find((a) => a.username === username) ?? null }
  saveData(userId, data, rev) { Object.assign(this.accounts.get(userId), { data, rev }) }
  rename(id, name) { this.users.get(id).name = name }
  friendsOf(id) { return [...(this.friends.get(id) ?? [])] }
  addFriendship(a, b) {
    for (const [x, y] of [[a, b], [b, a]]) this.friends.set(x, new Set([...(this.friends.get(x) ?? []), y]))
  }
  removeFriendship(a, b) {
    this.friends.get(a)?.delete(b)
    this.friends.get(b)?.delete(a)
  }
}
