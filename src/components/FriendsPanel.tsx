import { Check, Copy, Crosshair, Pencil, Play, UserMinus, UserPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { tuneToFriend } from '../social/friendStation'
import { friendStatus } from '../social/friendStatus'
import { presenceClient } from '../social/PresenceClient'
import { formatCode, LIMITS, normalizeCode } from '../social/protocol'
import { useRadioStore } from '../store/useRadioStore'
import { ToggleSwitch } from './deck/ToggleSwitch'
import { button, DrawerRow, input, RowButton } from './DrawerRow'


function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function JoinForm() {
  const error = useRadioStore((s) => s.friends.error)
  const status = useRadioStore((s) => s.friends.status)
  const setDrawer = useRadioStore((s) => s.setDrawer)
  const [name, setName] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) void presenceClient.signIn(name)
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 p-1 font-term text-[17px] leading-tight text-zinc-400">
      <p>See which friends are listening right now, what they're tuned to, and who's in a focus session.</p>
      <label className="flex flex-col gap-1">
        <span className="engraved text-[13px] uppercase">Pick a nickname</span>
        <div className="flex gap-1.5">
          <input className={input} value={name} maxLength={LIMITS.nameLength} onChange={(e) => setName(e.target.value)} placeholder="e.g. night owl" />
          <button type="submit" className={button} disabled={!name.trim() || status === 'connecting'}>
            {status === 'connecting' ? '…' : 'Join'}
          </button>
        </div>
      </label>
      {error && <p role="alert" className="text-hot">{error}</p>}
      <button type="button" onClick={() => setDrawer('account')} className="self-start text-[16px] text-amber-300 underline hover:text-amber-200">
        Have an account? Sign in
      </button>
      <p className="text-[15px] text-zinc-500">
        No sign-up needed: you get a friend code on this device, and can save it to an account later to use it elsewhere.
        Friends you add see your nickname, avatar, the station you're playing and your focus timer, nothing else. You can hide what you listen to or appear offline any time.
      </p>
    </form>
  )
}

function SelfCard() {
  const self = useRadioStore((s) => s.friends.self)!
  const status = useRadioStore((s) => s.friends.status)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(self.name)
  const code = formatCode(self.code)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked; the code is on screen to copy by hand
    }
  }

  return (
    <div className="lcd flex flex-col gap-1 rounded-[3px] px-3 py-2 font-term text-lcd">
      <div className="flex items-center justify-between gap-2">
        {editing ? (
          <form
            className="flex flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) presenceClient.rename(name)
              setEditing(false)
            }}
          >
            <input className={input} autoFocus value={name} maxLength={LIMITS.nameLength} onChange={(e) => setName(e.target.value)} aria-label="Nickname" />
            <button type="submit" aria-label="Save nickname" title="Save nickname" className="grid size-7 place-items-center rounded-[3px] border border-black bg-zinc-700 text-zinc-200 hover:text-amber-300">
              <Check size={14} />
            </button>
          </form>
        ) : (
          <>
            <span className="glow-text truncate text-[22px] leading-none">{self.name}</span>
            <RowButton label="Change nickname" onClick={() => setEditing(true)} disabled={status !== 'online'}>
              <Pencil size={13} />
            </RowButton>
          </>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-[16px]">
        <span className="text-lcd-dim">
          Your code <span className="text-lcd tabular-nums select-all">{code}</span>
        </span>
        <button type="button" onClick={() => void copy()} className="flex items-center gap-1 text-lcd-dim hover:text-lcd" aria-label="Copy friend code">
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <div className="text-[14px] leading-none text-lcd-dim">
        {status === 'online' ? '● connected' : status === 'offline' ? '◌ reconnecting…' : '◌ connecting…'}
      </div>
    </div>
  )
}

function AddFriend() {
  const status = useRadioStore((s) => s.friends.status)
  const error = useRadioStore((s) => s.friends.error)
  const [code, setCode] = useState('')
  const valid = normalizeCode(code) !== null
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = normalizeCode(code)
    if (clean && presenceClient.addFriend(clean)) setCode('')
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        <input className={input} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Friend's code, PR-XXXX-XXXX" aria-label="Code of the friend to add" />
        <button type="submit" className={button} disabled={!valid || status !== 'online'}>
          <UserPlus size={14} /> Add
        </button>
      </div>
      {error && <p role="alert" className="font-term text-[15px] text-hot">{error}</p>}
    </form>
  )
}

/** Friends tab of the drawer: profile, add-by-code, privacy switches and the live list. */
export function FriendsPanel() {
  const friends = useRadioStore((s) => s.friends)
  const social = useRadioStore((s) => s.social)
  const setSocial = useRadioStore((s) => s.setSocial)
  const flyTo = useRadioStore((s) => s.flyTo)
  const powered = useRadioStore((s) => s.powered)
  const now = useMinuteTick()

  if (friends.status === 'unconfigured') {
    return (
      <p className="p-2 font-term text-[17px] leading-tight text-zinc-500">
        Friends need the presence server, and this build doesn't have one configured. Set <code className="text-zinc-300">VITE_PRESENCE_URL</code> when
        building (see the README).
      </p>
    )
  }
  if (friends.status === 'signed-out' || !friends.self) return <JoinForm />

  const online = friends.list.filter((f) => f.online).length
  return (
    <div className="flex flex-col gap-3">
      <SelfCard />
      <AddFriend />
      <div className="flex flex-wrap gap-1.5">
        <ToggleSwitch label="Share listening" checked={social.shareListening} onChange={(shareListening) => setSocial({ shareListening })} />
        <ToggleSwitch label="Appear offline" checked={social.appearOffline} onChange={(appearOffline) => setSocial({ appearOffline })} color="#ff4d6d" />
      </div>

      <section aria-label="Friends">
        <h3 className="engraved mb-1 font-term text-[13px] uppercase">
          Friends · {online} online
        </h3>
        {friends.list.length === 0 ? (
          <p className="p-1 font-term text-[16px] leading-tight text-zinc-500">Share your code, or add a friend's code above.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {friends.list.map((f) => {
              const st = f.online ? f.presence?.station : null
              return (
                <DrawerRow
                  key={f.userId}
                  title={f.name}
                  subtitle={friendStatus(f, friends.receivedAt[f.userId], now)}
                  leading={
                    <span
                      aria-label={f.online ? 'online' : 'offline'}
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: f.online ? '#7dffa8' : '#3f3f46', boxShadow: f.online ? '0 0 6px #7dffa8' : 'none' }}
                    />
                  }
                  actions={
                    <>
                      <RowButton label={st ? `Tune in to ${st.name}` : 'Not sharing a station'} onClick={() => void tuneToFriend(f)} disabled={!st || !powered}>
                        <Play size={14} fill="currentColor" />
                      </RowButton>
                      <RowButton
                        label={`Show ${f.name} on the map`}
                        onClick={() => st?.lat != null && st.lon != null && flyTo(st.lon, st.lat, 6)}
                        disabled={st?.lat == null}
                      >
                        <Crosshair size={14} />
                      </RowButton>
                      <RowButton
                        label={`Remove ${f.name}`}
                        onClick={() => window.confirm(`Remove ${f.name} from your friends? You'll disappear from their list too.`) && presenceClient.removeFriend(f.userId)}
                        disabled={friends.status !== 'online'}
                      >
                        <UserMinus size={14} />
                      </RowButton>
                    </>
                  }
                />
              )
            })}
          </ul>
        )}
      </section>

      {friends.self.username ? (
        <button
          type="button"
          onClick={() => void presenceClient.signOut()}
          className="self-start font-term text-[15px] text-zinc-500 underline hover:text-zinc-300"
        >
          Sign out of {friends.self.username} on this device
        </button>
      ) : (
        <button
          type="button"
          onClick={() =>
            window.confirm('Forget this friends profile on this device? Your code stops working here and friends will need your new one.') &&
            void presenceClient.signOut()
          }
          className="self-start font-term text-[15px] text-zinc-500 underline hover:text-zinc-300"
        >
          Forget this profile on this device
        </button>
      )}
    </div>
  )
}
