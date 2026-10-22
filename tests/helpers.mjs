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
