import { useEffect } from 'react'
import { nowPlaying } from '../nowplaying/NowPlaying'

/** React owns the lifetime; the service owns lookups and polling. */
export function useNowPlaying() {
  useEffect(() => nowPlaying.connect(), [])
}
