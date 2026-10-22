export default class FakeHls {
  static Events = { ERROR: 'hlsError', FRAG_PARSING_METADATA: 'hlsFragParsingMetadata' }
  static instances = []
  static isSupported() { return true }
  handlers = new Map()
  constructor() { FakeHls.instances.push(this) }
  on(event, callback) { this.handlers.set(event, callback) }
  off(event) { this.handlers.delete(event) }
  loadSource() {}
  attachMedia() {}
  destroy() { this.destroyed = true; this.handlers.clear() }
  fatal() { this.handlers.get('hlsError')?.('hlsError', { fatal: true, details: 'networkError' }) }
}
