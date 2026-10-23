import { Cloud, CloudOff, LogIn, LogOut, RefreshCw, UserPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { presenceClient } from '../social/PresenceClient'
import { LIMITS, normalizeUsername } from '../social/protocol'
import { useRadioStore } from '../store/useRadioStore'
import { button, input } from './DrawerRow'
import { SiteLinks } from './SiteLinks'

const note = 'font-term text-[15px] leading-tight text-zinc-500'
const label = 'engraved text-[13px] uppercase'

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

const ago = (then: number, now: number) => {
  const s = Math.max(0, Math.round((now - then) / 1000))
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}

/** Username + password fields; the nickname field only when there's no profile to keep. */
function CredentialsForm({ mode, askName, onDone }: { mode: 'login' | 'signup'; askName: boolean; onDone?: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signup = mode === 'signup'
  const valid =
    normalizeUsername(username) !== null &&
    password.length >= (signup ? LIMITS.minPassword : 1) &&
    (!signup || !askName || name.trim().length > 0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      if (signup) await presenceClient.createAccount({ username, password, ...(askName ? { name } : {}) })
      else await presenceClient.logIn(username, password)
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 font-term text-[17px] text-zinc-400">
      {signup && askName && (
        <label className="flex flex-col gap-1">
          <span className={label}>Nickname friends see</span>
          <input className={input} value={name} maxLength={LIMITS.nameLength} onChange={(e) => setName(e.target.value)} placeholder="e.g. night owl" />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className={label}>Username</span>
        <input
          className={input}
          value={username}
          maxLength={20}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="3–20 letters, numbers, . _ -"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={label}>Password</span>
        <input
          className={input}
          type="password"
          value={password}
          maxLength={LIMITS.maxPassword}
          autoComplete={signup ? 'new-password' : 'current-password'}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={signup ? `At least ${LIMITS.minPassword} characters` : ''}
        />
      </label>
      {error && (
        <p role="alert" className="text-[16px] leading-tight text-hot">
          {error}
        </p>
      )}
      <button type="submit" className={`${button} self-start`} disabled={!valid || busy}>
        {signup ? <UserPlus size={14} /> : <LogIn size={14} />}
        {busy ? '…' : signup ? 'Create account' : 'Sign in'}
      </button>
    </form>
  )
}

function SignedOut() {
  const self = useRadioStore((s) => s.friends.self)
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const tab = (m: typeof mode, text: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => setMode(m)}
      className={`flex-1 px-2 py-1.5 font-term text-[14px] leading-none tracking-wide uppercase ${
        mode === m ? 'bg-amber-400/90 text-black' : 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-300 hover:text-amber-200'
      }`}
    >
      {text}
    </button>
  )
  return (
    <div className="flex flex-col gap-3 p-1">
      <p className="font-term text-[17px] leading-tight text-zinc-400">
        An account is optional. It keeps your favorites, recents, saved setups, avatar, passport progress and friends safe and the same on every device you sign in on.
      </p>
      <div role="tablist" aria-label="Account" className="flex overflow-hidden rounded-[3px] border border-black bg-black">
        {tab('login', 'Sign in')}
        {tab('signup', self ? 'Save profile' : 'Create account')}
      </div>
      {mode === 'login' ? (
        <>
          <CredentialsForm key="login" mode="login" askName={false} />
          {self && (
            <p className={note}>
              Signing in replaces this device's profile ({self.name}). To keep it and its friends, use Save profile instead.
            </p>
          )}
        </>
      ) : (
        <>
          <CredentialsForm key="signup" mode="signup" askName={!self} />
          <p className={note}>
            {self
              ? `Your profile ${self.name} keeps its friend code and friends. Things on this device are saved to the account.`
              : 'This also makes your friends profile. Things on this device are saved to the account.'}{' '}
            There's no password reset, so pick something you'll remember.
          </p>
        </>
      )}
    </div>
  )
}

function SignedIn({ username }: { username: string }) {
  const account = useRadioStore((s) => s.account)
  const self = useRadioStore((s) => s.friends.self)
  const now = useNow(30_000)
  const status =
    account.status === 'error'
      ? `Not synced: ${account.error ?? 'unknown error'}`
      : account.status === 'syncing'
        ? 'Syncing…'
        : account.lastSync
          ? `Synced ${ago(account.lastSync, now)}`
          : 'Waiting to sync'
  return (
    <div className="flex flex-col gap-3">
      <div className="lcd flex flex-col gap-1 rounded-[3px] px-3 py-2 font-term text-lcd">
        <span className="glow-text truncate text-[22px] leading-none">{username}</span>
        {self && <span className="text-[16px] text-lcd-dim">Friends see you as {self.name}</span>}
        <span className={`flex items-center gap-1.5 text-[15px] leading-none ${account.status === 'error' ? 'text-hot' : 'text-lcd-dim'}`}>
          {account.status === 'error' ? <CloudOff size={13} /> : <Cloud size={13} />}
          {status}
        </span>
      </div>
      <p className={note}>Favorites, recents, saved setups, your avatar, passport progress and friends follow you to any device you sign in on. Mixer and screen settings stay per device.</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={button} onClick={() => void presenceClient.syncNow()}>
          <RefreshCw size={14} /> Sync now
        </button>
        <button type="button" className={button} onClick={() => void presenceClient.signOut()}>
          <LogOut size={14} /> Sign out here
        </button>
      </div>
      <p className={note}>Signing out keeps this device's copy; signing in again merges it back.</p>
    </div>
  )
}

/** Account tab of the drawer: optional sign-in that syncs your stuff between devices. */
export function AccountPanel() {
  const status = useRadioStore((s) => s.friends.status)
  const username = useRadioStore((s) => s.friends.self?.username ?? null)
  if (status === 'unconfigured') {
    return (
      <p className="p-2 font-term text-[17px] leading-tight text-zinc-500">
        Accounts use the friends server, and this build doesn't have one configured. Set <code className="text-zinc-300">VITE_PRESENCE_URL</code> when
        building (see the README).
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {username ? <SignedIn username={username} /> : <SignedOut />}
      <SiteLinks className="text-[13px]" />
    </div>
  )
}
