import { Crown, DoorOpen, Link, Radio, Timer, UserPlus } from 'lucide-react'
import { roomLink } from '../routing/deepLink'
import { applySettings } from '../session/play'
import { parseSessionQuery } from '../session/setup'
import { copyText } from '../share/share'
import { presenceClient } from '../social/PresenceClient'
import { useRadioStore } from '../store/useRadioStore'
import { ToggleSwitch } from './deck/ToggleSwitch'
import { RowButton } from './DrawerRow'

const button =
  'flex items-center gap-1.5 rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2.5 py-1 font-term text-[15px] leading-none tracking-wider text-zinc-200 uppercase shadow-[0_2px_0_#000] hover:text-amber-300 disabled:opacity-40'

/** Invitations waiting for an answer. Nobody is ever put in a room without saying yes. */
export function RoomInvites() {
  const invites = useRadioStore((s) => s.roomInvites)
  if (!invites.length) return null
  return (
    <ul aria-label="Room invitations" className="flex flex-col gap-1.5">
      {invites.map((i) => (
        <li key={i.code} className="rounded-[3px] border border-[#7df9ff]/50 bg-[#7df9ff]/10 px-2 py-1.5 font-read text-[13px] leading-snug text-zinc-100">
          <p>
            <span className="font-medium text-[#7df9ff]">{i.from.name}</span> invited you to a room{i.station ? ` · ${i.station.name}` : ''}
          </p>
          <div className="mt-1 flex gap-1.5">
            <button type="button" className={button} onClick={() => presenceClient.joinRoom(i.code)}>
              Join
            </button>
            <button type="button" className={button} onClick={() => presenceClient.declineRoom(i.code)}>
              Not now
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Start a room, or the room you're in: members, who hosts, following and the host's mood. */
export function RoomPanel() {
  const room = useRadioStore((s) => s.room)
  const me = useRadioStore((s) => s.friends.self?.userId)
  const online = useRadioStore((s) => s.friends.status === 'online')
  const follow = useRadioStore((s) => s.social.followRoom)
  const setSocial = useRadioStore((s) => s.setSocial)
  const supported = useRadioStore((s) => s.friends.serverVersion >= 2)

  // An older friends server has no rooms; say nothing rather than offer broken buttons
  if (!room && !supported) return null
  if (!room) {
    return (
      <section aria-labelledby="room-heading" className="flex flex-col gap-1.5">
        <h3 id="room-heading" className="engraved font-term text-[13px] uppercase">Listen together</h3>
        <p className="font-read text-[12px] leading-snug text-zinc-500">
          Start a room and invite friends. You choose the station; a study room shares one focus timer.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={button} disabled={!online} onClick={() => presenceClient.createRoom(false)}>
            <Radio size={14} /> Listening room
          </button>
          <button type="button" className={button} disabled={!online} onClick={() => presenceClient.createRoom(true)}>
            <Timer size={14} /> Study room
          </button>
        </div>
      </section>
    )
  }

  const host = room.host === me
  const mood = room.mood ? parseSessionQuery(room.mood) : null
  return (
    <section aria-labelledby="room-heading" className="lcd flex flex-col gap-1.5 rounded-[3px] px-3 py-2 text-lcd">
      <div className="flex items-center justify-between gap-2">
        <h3 id="room-heading" className="font-term text-[18px] leading-none">
          {room.study ? 'Study room' : 'Listening room'} · ROOM-{room.code}
        </h3>
        <RowButton label="Copy the room link" onClick={() => void copyText(roomLink(room.code), 'Room link copied')}>
          <Link size={13} />
        </RowButton>
      </div>
      <p className="font-read text-[12px] leading-snug text-lcd/80">
        {room.station ? `On ${room.station.name}, from ${room.station.location}.` : 'No station yet.'}{' '}
        {host ? 'You host: the room follows your station.' : 'The host chooses the station.'}
      </p>
      <ul className="flex flex-col gap-0.5 font-read text-[13px]">
        {room.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-1.5">
            {m.userId === room.host ? <Crown size={12} className="text-amber-300" aria-label="host" /> : <span className="w-3" />}
            <span className="flex-1 truncate">
              {m.userId === me ? `${m.name} (you)` : m.name}
              {!m.here && room.station && <span className="text-lcd-dim"> · listening elsewhere</span>}
            </span>
            {host && m.userId !== me && (
              <button type="button" className="text-[11px] text-lcd-dim underline hover:text-lcd" onClick={() => presenceClient.makeHost(m.userId)}>
                make host
              </button>
            )}
          </li>
        ))}
      </ul>
      {!host && <ToggleSwitch label="Follow the host's station" checked={follow} onChange={(followRoom) => setSocial({ followRoom })} />}
      {!host && mood && (
        <button type="button" className={`${button} self-start`} onClick={() => applySettings(mood)}>
          Match the host's weather & sound
        </button>
      )}
      {host && (
        <p className="font-read text-[11px] leading-snug text-lcd-dim">
          <UserPlus size={11} className="mr-1 inline" />
          Invite friends from your list below.
        </p>
      )}
      <button type="button" className={`${button} self-start`} onClick={() => presenceClient.leaveRoom()}>
        <DoorOpen size={14} /> Leave room
      </button>
    </section>
  )
}
