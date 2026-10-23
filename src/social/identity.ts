import { normalizeCode, normalizeName, normalizeUsername, type RegisterResponse } from './protocol'

/**
 * This device's friends profile; `username` is set once it's an account. The token is a
 * bearer secret; it never leaves this origin's storage.
 */
export type Identity = RegisterResponse

const KEY = 'pixel-radio.identity'

/**
 * Reduce the configured server address to its origin: the API always lives at the root,
 * so a pasted "/api/health" or trailing slash can't send requests to the wrong path.
 */
export function presenceOrigin(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`)
    return /^https?:$/.test(url.protocol) ? url.origin : ''
  } catch {
    return ''
  }
}

/** Presence server origin, e.g. https://pixel-radio-presence.example.workers.dev (empty: friends disabled). */
export const PRESENCE_URL = presenceOrigin(import.meta.env?.VITE_PRESENCE_URL ?? '')

/** Validate a stored or received profile; null if anything is missing. */
function identityOf(raw: unknown): Identity | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { userId, name, code, token, username } = raw as Record<string, unknown>
  const cleanName = normalizeName(name)
  const cleanCode = normalizeCode(code)
  if (typeof userId !== 'string' || typeof token !== 'string' || !cleanName || !cleanCode) return null
  return { userId, name: cleanName, code: cleanCode, token, username: normalizeUsername(username) }
}

export function loadIdentity(): Identity | null {
  try {
    return identityOf(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null'))
  } catch {
    return null
  }
}

export function saveIdentity(identity: Identity | null) {
  try {
    if (identity) globalThis.localStorage?.setItem(KEY, JSON.stringify(identity))
    else globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Without storage the profile lasts for this tab only
  }
}

/** A failed API call; `body` carries extra fields such as the newer copy on a 409. */
export class ApiError extends Error {
  status: number
  body: Record<string, unknown> | null
  constructor(status: number, message: string, body: Record<string, unknown> | null) {
    super(message)
    this.status = status
    this.body = body
  }
}

async function api(
  baseUrl: string,
  path: string,
  { method = 'POST', token, body, signal, keepalive }: { method?: string; token?: string | null; body?: unknown; signal?: AbortSignal; keepalive?: boolean } = {},
): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(8000)
  const res = await fetch(`${baseUrl}/api/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    keepalive,
  })
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    // Our server always answers with a JSON error; anything else means the address is wrong or the server is older
    const fallback =
      res.status === 404 && path.startsWith('account/')
        ? 'Accounts need the updated friends server.'
        : `No friends server answered at ${baseUrl} (HTTP ${res.status}). Check VITE_PRESENCE_URL.`
    throw new ApiError(res.status, typeof json?.error === 'string' && json.error ? json.error : fallback, json)
  }
  if (!json) throw new Error('Unexpected server response')
  return json
}

const identityFrom = (body: Record<string, unknown>) => {
  const identity = identityOf(body)
  if (!identity) throw new Error('Unexpected server response')
  return identity
}

export async function registerProfile(baseUrl: string, name: string, signal?: AbortSignal): Promise<Identity> {
  return identityFrom(await api(baseUrl, 'register', { body: { name }, signal }))
}

/** Create an account, or turn this device's profile (`token`) into one so it keeps its friends. */
export async function signupAccount(baseUrl: string, fields: { username: string; password: string; name?: string }, token: string | null): Promise<Identity> {
  return identityFrom(await api(baseUrl, 'account/signup', { body: fields, token }))
}

export async function loginAccount(baseUrl: string, username: string, password: string): Promise<{ identity: Identity; data: unknown; rev: number }> {
  const body = await api(baseUrl, 'account/login', { body: { username, password } })
  return { identity: identityFrom(body), data: body.data ?? null, rev: typeof body.rev === 'number' ? body.rev : 0 }
}

/** Revoke this device's sign-in; best effort, since the local copy is forgotten either way. */
export async function logoutAccount(baseUrl: string, token: string) {
  await api(baseUrl, 'account/logout', { token }).catch(() => undefined)
}

export async function fetchAccountData(baseUrl: string, token: string): Promise<{ data: unknown; rev: number }> {
  const body = await api(baseUrl, 'account/data', { method: 'GET', token })
  return { data: body.data ?? null, rev: typeof body.rev === 'number' ? body.rev : 0 }
}

/** Save synced data against the revision last seen; a 409 ApiError carries the newer copy. */
export async function saveAccountData(baseUrl: string, token: string, data: unknown, rev: number, keepalive = false): Promise<number> {
  const body = await api(baseUrl, 'account/data', { method: 'PUT', token, body: { data, rev }, keepalive })
  return typeof body.rev === 'number' ? body.rev : rev + 1
}
