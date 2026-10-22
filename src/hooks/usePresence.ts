import { useEffect } from 'react'
import { presenceClient } from '../social/PresenceClient'

/** React owns the connection lifetime; the client owns the socket. */
export function usePresence() {
  useEffect(() => presenceClient.connect(), [])
}
