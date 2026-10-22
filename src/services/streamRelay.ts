import { PRESENCE_URL } from '../social/identity'
import type { Station } from '../types'

let status: Promise<boolean> | null = null

/**
 * Whether the friends Worker relays plain-http streams (its STREAM_RELAY switch). Asked
 * once per page load; no server, an error or a slow answer all count as off.
 */
export function relayAvailable(server = PRESENCE_URL, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  status ??= server
    ? fetchImpl(`${server}/api/relay`, { signal: AbortSignal.timeout(2500) })
      .then((res) => res.status === 204)
      .catch(() => false)
    : Promise.resolve(false)
  return status
}

/** The address the player loads: the relay for relayed stations, the stream itself otherwise. */
export const playbackUrl = (station: Station, server = PRESENCE_URL) =>
  station.relay && server ? `${server}/api/relay/${encodeURIComponent(station.id)}` : station.url
