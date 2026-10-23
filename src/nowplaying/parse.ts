/**
 * Song-title parsing shared by the browser and the presence Worker. Stations announce
 * "Artist - Title" in three common ways: ICY metadata blocks inside Icecast/SHOUTcast
 * streams, ID3 frames inside HLS segments, and Icecast's status-json.xsl page.
 */

export const MAX_TITLE = 120

/** Reject placeholders stations send between songs, tidy whitespace and cap length. */
export function cleanTitle(raw: unknown, stationName = ''): string | null {
  if (typeof raw !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  if (!title || /^[-–—\s|:]*$/.test(title)) return null
  const lower = title.toLowerCase()
  if (['unknown', 'unknown - unknown', 'n/a', 'live', 'on air', 'jingle'].includes(lower)) return null
  // Some stations just repeat their own name
  if (stationName && lower === stationName.trim().toLowerCase()) return null
  return [...title].slice(0, MAX_TITLE).join('')
}

const decode = (bytes: Uint8Array) => {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  // Older servers send Latin-1; fall back when UTF-8 decoding produced replacement characters
  return utf8.includes('�') ? new TextDecoder('latin1').decode(bytes) : utf8
}

/** `StreamTitle='Artist - Title';StreamUrl='';` → "Artist - Title". */
export function parseIcyMetadata(block: Uint8Array | string): string | null {
  const text = typeof block === 'string' ? block : decode(block).replace(/\0+$/, '')
  // Titles may themselves contain apostrophes, so end at "';" (or the end of the block)
  const match = /StreamTitle='(.*?)'(?:;|$)/s.exec(text)
  return match ? cleanTitle(match[1]) : null
}

/**
 * Read stream bytes until the first ICY metadata block (after `metaint` audio bytes).
 * Returns undefined while more bytes are needed, null when the block is empty.
 */
export function icyTitleFromBytes(bytes: Uint8Array, metaint: number): string | null | undefined {
  if (bytes.length <= metaint) return undefined
  const length = bytes[metaint] * 16
  if (length === 0) return null
  if (bytes.length < metaint + 1 + length) return undefined
  return parseIcyMetadata(bytes.subarray(metaint + 1, metaint + 1 + length))
}

const synchsafe = (b: Uint8Array, i: number) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f)

function id3Text(frame: Uint8Array): string {
  const encoding = frame[0]
  const body = frame.subarray(1)
  if (encoding === 1 || encoding === 2) {
    // UTF-16 with or without BOM
    const bom = (body[0] === 0xff && body[1] === 0xfe) || (body[0] === 0xfe && body[1] === 0xff)
    const le = bom ? body[0] === 0xff : encoding === 1
    return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(body.subarray(bom ? 2 : 0)).replace(/\0+$/, '')
  }
  return (encoding === 3 ? new TextDecoder('utf-8') : new TextDecoder('latin1')).decode(body).replace(/\0+$/, '')
}

/**
 * Title from an ID3v2 tag (HLS timed metadata): TPE1/TIT2 as "Artist - Title",
 * or an ICY-style StreamTitle carried in a TXXX/PRIV frame.
 */
export function parseId3Title(tag: Uint8Array): string | null {
  if (tag.length < 10 || tag[0] !== 0x49 || tag[1] !== 0x44 || tag[2] !== 0x33) return null
  const version = tag[3]
  const end = Math.min(tag.length, 10 + synchsafe(tag, 6))
  let artist = ''
  let title = ''
  let streamTitle: string | null = null
  for (let i = 10; i + 10 <= end; ) {
    const id = String.fromCharCode(tag[i], tag[i + 1], tag[i + 2], tag[i + 3])
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const size = version >= 4 ? synchsafe(tag, i + 4) : (tag[i + 4] << 24) | (tag[i + 5] << 16) | (tag[i + 6] << 8) | tag[i + 7]
    const frame = tag.subarray(i + 10, Math.min(end, i + 10 + size))
    if (id === 'TIT2') title = id3Text(frame)
    else if (id === 'TPE1') artist = id3Text(frame)
    else if (id === 'TXXX' || id === 'PRIV') streamTitle ??= parseIcyMetadata(new TextDecoder('latin1').decode(frame))
    if (size <= 0) break
    i += 10 + size
  }
  if (title) return cleanTitle(artist ? `${artist} - ${title}` : title)
  return streamTitle
}

interface IcecastSource {
  listenurl?: unknown
  title?: unknown
  artist?: unknown
  yp_currently_playing?: unknown
}

/** Pick the mount matching the stream from Icecast's /status-json.xsl. */
export function parseIcecastStatus(json: unknown, streamUrl: string): string | null {
  const stats = (json as { icestats?: { source?: IcecastSource | IcecastSource[] } } | null)?.icestats
  const raw = stats?.source
  const sources = Array.isArray(raw) ? raw : raw ? [raw] : []
  if (!sources.length) return null
  let path = ''
  try {
    path = new URL(streamUrl).pathname
  } catch {
    // keep empty: a single mount still matches
  }
  const mount =
    sources.find((s) => {
      try {
        return typeof s.listenurl === 'string' && new URL(s.listenurl).pathname === path
      } catch {
        return false
      }
    }) ?? (sources.length === 1 ? sources[0] : undefined)
  if (!mount) return null
  const title = typeof mount.title === 'string' ? mount.title : ''
  const artist = typeof mount.artist === 'string' ? mount.artist : ''
  return cleanTitle(artist && title ? `${artist} - ${title}` : title || mount.yp_currently_playing)
}
