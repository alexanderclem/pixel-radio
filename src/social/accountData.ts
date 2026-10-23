import type { Avatar } from '../avatar/parts'
import { mergeProgress, sanitizeProgress, sanitizeUnlocks, type Progress, type UnlockId } from '../avatar/unlocks'
import { isObject, MAX_FAVORITES, MAX_RECENTS, stationList, type Library } from '../store/useRadioStore'
import type { Station } from '../types'
import { sanitizeAvatar } from './protocol'

/**
 * What an account carries between devices. Mixer, screen and timer settings stay on
 * each device; friends live on the server already.
 */
export interface AccountData {
  v: 1
  library: Library
  avatar: Avatar
  unlocks: UnlockId[]
  progress: Progress
}

export const snapshot = (s: { library: Library; avatar: Avatar; unlocks: UnlockId[]; progress: Progress }): AccountData => ({
  v: 1,
  library: s.library,
  avatar: s.avatar,
  unlocks: s.unlocks,
  progress: s.progress,
})

/** Server copies are written by clients, so validate them like any saved data; null if unusable. */
export function sanitizeAccountData(raw: unknown): AccountData | null {
  if (!isObject(raw)) return null
  const avatar = sanitizeAvatar(raw.avatar)
  if (!avatar) return null
  const library = isObject(raw.library) ? raw.library : {}
  return {
    v: 1,
    library: { favorites: stationList(library.favorites, MAX_FAVORITES), recents: stationList(library.recents, MAX_RECENTS) },
    avatar,
    unlocks: sanitizeUnlocks(raw.unlocks),
    progress: sanitizeProgress(raw.progress),
  }
}

const union = (first: Station[], second: Station[], max: number) => {
  const ids = new Set(first.map((s) => s.id))
  return [...first, ...second.filter((s) => !ids.has(s.id))].slice(0, max)
}

/**
 * Combine two copies changed independently: station lists and unlocks are joined (the
 * remote order first), progress keeps the larger counts, and one side's avatar wins.
 */
export function mergeAccountData(local: AccountData, remote: AccountData, { preferRemoteAvatar }: { preferRemoteAvatar: boolean }): AccountData {
  return {
    v: 1,
    library: {
      favorites: union(remote.library.favorites, local.library.favorites, MAX_FAVORITES),
      recents: union(remote.library.recents, local.library.recents, MAX_RECENTS),
    },
    avatar: preferRemoteAvatar ? remote.avatar : local.avatar,
    unlocks: [...new Set([...remote.unlocks, ...local.unlocks])],
    progress: mergeProgress(local.progress, remote.progress),
  }
}

export const sameData = (a: AccountData | null, b: AccountData | null) => JSON.stringify(a) === JSON.stringify(b)
