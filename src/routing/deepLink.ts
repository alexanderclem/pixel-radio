import { parseSessionQuery, type SessionSettings } from '../session/setup'
import { isId, normalizeCode, normalizeRoomCode } from '../social/protocol'

/**
 * Shareable paths: /s/<station id> plays a station (with ?… a whole session: weather, sky,
 * mix, map view), /f/<friend code> adds a friend, /r/<room code> joins a room. The site
 * serves the app for any path.
 */
export type DeepLink =
  | { kind: 'station'; id: string; session: Partial<SessionSettings> | null }
  | { kind: 'friend'; code: string }
  | { kind: 'room'; code: string }

export function parseDeepLink(pathname: string, search = ''): DeepLink | null {
  const match = /^\/([sfr])\/([^/]+)\/?$/.exec(pathname)
  if (!match) return null
  let value: string
  try {
    value = decodeURIComponent(match[2])
  } catch {
    return null
  }
  if (match[1] === 's') return isId(value) ? { kind: 'station', id: value, session: parseSessionQuery(search) } : null
  if (match[1] === 'f') {
    const code = normalizeCode(value)
    return code ? { kind: 'friend', code } : null
  }
  const code = normalizeRoomCode(value)
  return code ? { kind: 'room', code } : null
}

/** Read the link the page was opened with, then tidy the address bar back to the root. */
export function consumeDeepLink(loc: Pick<Location, 'pathname' | 'search'> = location, hist: Pick<History, 'replaceState'> = history): DeepLink | null {
  const link = parseDeepLink(loc.pathname, loc.search)
  if (loc.pathname !== '/') {
    try {
      hist.replaceState(null, '', '/')
    } catch {
      // Sandboxed frames may refuse; the link still works
    }
  }
  return link
}

const origin = () => (typeof location === 'undefined' ? '' : location.origin)

export const stationLink = (id: string, base = origin()) => `${base}/s/${encodeURIComponent(id)}`
export const inviteLink = (code: string, base = origin()) => `${base}/f/${code}`
export const roomLink = (code: string, base = origin()) => `${base}/r/${code}`
