import { normalizeCode, normalizeName, type RegisterResponse } from './protocol'

/** This device's friends profile. The token is a bearer secret; it never leaves this origin's storage. */
export type Identity = RegisterResponse

const KEY = 'pixel-radio.identity'

/** Presence server origin, e.g. https://pixel-radio-presence.example.workers.dev (empty: friends disabled). */
export const PRESENCE_URL = (import.meta.env?.VITE_PRESENCE_URL ?? '').trim().replace(/\/+$/, '')

export function loadIdentity(): Identity | null {
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return null
    const { userId, name, code, token } = raw as Record<string, unknown>
    const cleanName = normalizeName(name)
    const cleanCode = normalizeCode(code)
    if (typeof userId !== 'string' || typeof token !== 'string' || !cleanName || !cleanCode) return null
    return { userId, name: cleanName, code: cleanCode, token }
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

export async function registerProfile(baseUrl: string, name: string, signal?: AbortSignal): Promise<Identity> {
  const res = await fetch(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
  })
  const body = (await res.json().catch(() => null)) as Partial<Identity> & { error?: string } | null
  if (!res.ok) throw new Error(body?.error || `Server error ${res.status}`)
  const code = normalizeCode(body?.code)
  const cleanName = normalizeName(body?.name)
  if (!body || typeof body.userId !== 'string' || typeof body.token !== 'string' || !code || !cleanName) {
    throw new Error('Unexpected server response')
  }
  return { userId: body.userId, name: cleanName, code, token: body.token }
}
