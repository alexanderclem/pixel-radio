import type { Avatar } from '../avatar/parts'
import { mergeProgress, sanitizeProgress, type Progress } from '../progress/progress'
import { isObject, MAX_FAVORITES, MAX_MOODS, MAX_RECENTS, MAX_SETUPS, moodList, setupList, stationList, type Library } from '../store/useRadioStore'
import { sanitizeAvatar } from './protocol'

/**
 * What an account carries between devices: favorites, recents, saved setups, your moods, the avatar,
 * and progress (focus log, passport stamps, rides; earned parts follow from it). Mixer,
 * screen and timer settings stay on each device; friends live on the server already.
 */
export interface AccountData {
  v: 1
  library: Library
  avatar: Avatar
  progress: Progress
}

export const snapshot = (s: { library: Library; avatar: Avatar; progress: Progress }): AccountData => ({
  v: 1,
  library: s.library,
  avatar: s.avatar,
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
    library: {
      favorites: stationList(library.favorites, MAX_FAVORITES),
      recents: stationList(library.recents, MAX_RECENTS),
      setups: setupList(library.setups),
      moods: moodList(library.moods),
    },
    avatar,
    progress: sanitizeProgress(raw.progress),
  }
}

/** Join two lists by id, `first` order first. */
const union = <T extends { id: string }>(first: T[], second: T[], max: number) => {
  const ids = new Set(first.map((x) => x.id))
  return [...first, ...second.filter((x) => !ids.has(x.id))].slice(0, max)
}

/**
 * Combine two copies changed independently: lists are joined (the remote order first),
 * progress keeps the larger numbers, and one side's avatar wins.
 */
export function mergeAccountData(local: AccountData, remote: AccountData, { preferRemoteAvatar }: { preferRemoteAvatar: boolean }): AccountData {
  return {
    v: 1,
    library: {
      favorites: union(remote.library.favorites, local.library.favorites, MAX_FAVORITES),
      recents: union(remote.library.recents, local.library.recents, MAX_RECENTS),
      setups: union(remote.library.setups, local.library.setups, MAX_SETUPS),
      moods: union(remote.library.moods, local.library.moods, MAX_MOODS),
    },
    avatar: preferRemoteAvatar ? remote.avatar : local.avatar,
    progress: mergeProgress(local.progress, remote.progress),
  }
}

export const sameData = (a: AccountData | null, b: AccountData | null) => JSON.stringify(a) === JSON.stringify(b)
