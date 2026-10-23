import { useRadioStore } from '../store/useRadioStore'
import { mergeAccountData, sameData, sanitizeAccountData, snapshot, type AccountData } from './accountData'
import { ApiError, fetchAccountData, saveAccountData, type Identity } from './identity'

const SAVE_DEBOUNCE_MS = 3000
const PULL_EVERY_MS = 30_000
const KEY = 'pixel-radio.sync'

type State = ReturnType<typeof useRadioStore.getState>

/** The copy this device last agreed with the server on, so a pull can tell local edits from stale data. */
interface Synced {
  userId: string
  rev: number
  data: AccountData | null
}

function loadSynced(): Synced | null {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return null
    const { userId, rev, data } = raw as Record<string, unknown>
    return typeof userId === 'string' && typeof rev === 'number' ? { userId, rev, data: sanitizeAccountData(data) } : null
  } catch {
    return null
  }
}

function saveSynced(synced: Synced | null) {
  try {
    if (synced) globalThis.localStorage?.setItem(KEY, JSON.stringify(synced))
    else globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Without storage the next load merges instead of fast-forwarding
  }
}

const syncedKey = (s: State) => JSON.stringify(snapshot(s))

interface Options {
  url: string
  identity: () => Identity | null
  fetchData?: typeof fetchAccountData
  saveData?: typeof saveAccountData
}

/**
 * Keeps an account's favorites, recents, avatar and unlocks the same on every device.
 * Saves are debounced and versioned: if another device saved first, the two copies are
 * merged and saved again. With no local edits since the last sync, the server copy is
 * taken as is, so removals on one device reach the others.
 */
export class AccountSync {
  private url: string
  private identity: () => Identity | null
  private fetchData: typeof fetchAccountData
  private saveData: typeof saveAccountData
  private synced: Synced | null = loadSynced()
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastPull = 0
  private busy: Promise<void> = Promise.resolve()

  constructor({ url, identity, fetchData = fetchAccountData, saveData = saveAccountData }: Options) {
    this.url = url
    this.identity = identity
    this.fetchData = fetchData
    this.saveData = saveData
  }

  private get account() {
    const id = this.identity()
    return id?.username ? id : null
  }

  /** Watch the store and the page; returns the cleanup. */
  start() {
    const unsubscribe = useRadioStore.subscribe((next, prev) => {
      if (!this.account) return
      if (syncedKey(next) !== syncedKey(prev)) this.schedule()
      // Connected (on load or after a drop): catch up with other devices
      if (next.friends.status === 'online' && prev.friends.status !== 'online') void this.pull()
    })
    const visibility = () => {
      if (!this.account) return
      if (document.visibilityState === 'hidden') void this.flush(true)
      else if (Date.now() - this.lastPull > PULL_EVERY_MS) void this.pull()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility)
    return () => {
      unsubscribe()
      clearTimeout(this.timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility)
    }
  }

  /** Just signed in or created the account: adopt the server's copy (if any) merged with this device's. */
  begin(remote: { data: unknown; rev: number } | null) {
    const account = this.account
    if (!account) return Promise.resolve()
    // A different account than the one last synced here: nothing local is "already synced"
    if (this.synced?.userId !== account.userId) this.setSynced({ userId: account.userId, rev: 0, data: null })
    return this.queue(async () => {
      if (remote) this.reconcile(remote, true)
      await this.push()
    })
  }

  /** Signed out: stop syncing and forget the sync point (the local copy stays). */
  end() {
    clearTimeout(this.timer)
    this.setSynced(null)
    useRadioStore.getState().setAccount({ status: 'none', lastSync: null, error: null })
  }

  pull() {
    const account = this.account
    if (!account) return Promise.resolve()
    this.lastPull = Date.now()
    return this.queue(async () => {
      try {
        if (this.synced?.userId !== account.userId) this.setSynced({ userId: account.userId, rev: 0, data: null })
        this.status('syncing')
        this.reconcile(await this.fetchData(this.url, account.token), false)
        await this.push()
      } catch (err) {
        this.fail(err)
      }
    })
  }

  private schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.queue(() => this.push()), SAVE_DEBOUNCE_MS)
  }

  /** Save now if anything is waiting; `leaving` uses a keepalive request that outlives the tab. */
  flush(leaving = false) {
    if (this.timer === undefined) return this.busy
    clearTimeout(this.timer)
    this.timer = undefined
    return this.queue(() => this.push(leaving))
  }

  /** One sync step at a time, so a pull and a save never race each other. */
  private queue(work: () => Promise<void>) {
    this.busy = this.busy.then(work, work)
    return this.busy
  }

  /** Bring a server copy into the store: as is when nothing changed here, else merged. */
  private reconcile(remote: { data: unknown; rev: number }, signingIn: boolean) {
    const account = this.account
    if (!account) return
    const theirs = sanitizeAccountData(remote.data)
    const local = snapshot(useRadioStore.getState())
    if (theirs) {
      const untouched = !signingIn && this.synced?.data !== null && sameData(local, this.synced?.data ?? null)
      const next = untouched ? theirs : mergeAccountData(local, theirs, { preferRemoteAvatar: signingIn })
      if (!sameData(next, local)) useRadioStore.getState().applySynced(next)
    }
    this.setSynced({ userId: account.userId, rev: remote.rev, data: theirs })
  }

  private async push(leaving = false, retried = false): Promise<void> {
    this.timer = undefined
    const account = this.account
    if (!account || !this.synced) return
    const data = snapshot(useRadioStore.getState())
    if (sameData(data, this.synced.data)) return this.status('synced')
    try {
      this.status('syncing')
      const rev = await this.saveData(this.url, account.token, data, this.synced.rev, leaving)
      this.setSynced({ userId: account.userId, rev, data })
      this.status('synced')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body && !retried) {
        // Another device saved first: merge with its copy and try once more
        this.reconcile({ data: err.body.data, rev: typeof err.body.rev === 'number' ? err.body.rev : 0 }, false)
        return this.push(leaving, true)
      }
      this.fail(err)
    }
  }

  private setSynced(synced: Synced | null) {
    this.synced = synced
    saveSynced(synced)
  }

  private status(status: 'syncing' | 'synced') {
    useRadioStore.getState().setAccount(status === 'synced' ? { status, lastSync: Date.now(), error: null } : { status })
  }

  private fail(err: unknown) {
    useRadioStore.getState().setAccount({ status: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
