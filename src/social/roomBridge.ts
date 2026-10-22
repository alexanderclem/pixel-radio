import type { RoomAction } from './protocol'

/**
 * Lets the focus timer hand its buttons to the shared room timer without importing the
 * presence client (which imports the timer). The presence client registers the sender.
 */
let sender: ((action: RoomAction) => boolean) | null = null

export const setRoomTimerSender = (fn: typeof sender) => {
  sender = fn
}

/** True when the action went to the room; the solo timer then leaves it alone. */
export const sendRoomTimer = (action: RoomAction) => sender?.(action) ?? false
