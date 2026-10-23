import { useEffect, useRef } from 'react'
import { CITIES } from '../constants/cities'
import { DEFAULT_AUDIO, useRadioStore } from '../store/useRadioStore'

interface ShortcutActions {
  stepStation: (delta: number) => void
  toggleTimer: () => void
  toggleFocusMode: () => void
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/** Global keyboard bindings; the map canvas keeps its own arrow/zoom keys. See constants/shortcuts.ts. */
export function useShortcuts(actions: ShortcutActions) {
  const actionsRef = useRef(actions)
  const lastMaster = useRef(DEFAULT_AUDIO.master)
  useEffect(() => {
    actionsRef.current = actions
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return
      const s = useRadioStore.getState()
      const { stepStation, toggleTimer, toggleFocusMode } = actionsRef.current
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

      if (key === 'Escape') {
        if (s.helpOpen) s.setHelpOpen(false)
        else if (s.drawer) s.setDrawer(null)
        else if (s.focus.mode) s.setFocus({ mode: false })
        else return
        e.preventDefault()
        return
      }
      if (key === '?') {
        s.setHelpOpen(!s.helpOpen)
        e.preventDefault()
        return
      }
      // Everything else needs the radio on and no modal open
      if (!s.powered || s.helpOpen) return

      const digit = /^[0-9]$/.test(key) ? (Number(key) + 9) % 10 : -1
      const run: Record<string, () => void> = {
        n: () => stepStation(1),
        b: () => stepStation(-1),
        '/': () => s.focusSearch(),
        l: () => s.locateActive(),
        h: () => s.resetView(),
        s: () => s.station && s.toggleFavorite(s.station),
        m: () => {
          if (s.audio.master > 0) {
            lastMaster.current = s.audio.master
            s.setAudio({ master: 0 })
          } else {
            s.setAudio({ master: lastMaster.current || DEFAULT_AUDIO.master })
          }
        },
        t: toggleTimer,
        f: toggleFocusMode,
        d: () => s.setDrawer(s.drawer === 'favorites' || s.drawer === 'recent' ? null : 'favorites'),
        g: () => s.setDrawer(s.drawer === 'friends' ? null : 'friends'),
        c: () => s.setDeckExpanded(!s.deckExpanded),
        a: () => s.setDrawer(s.drawer === 'avatar' ? null : 'avatar'),
        y: () => s.setDrawer(s.drawer === 'moods' ? null : 'moods'),
        p: () => s.setDrawer(s.drawer === 'passport' ? null : 'passport'),
        v: () => s.setSocial({ mapFilter: s.social.mapFilter === 'everyone' ? 'friends' : 'everyone' }),
        u: () => s.setDrawer(s.drawer === 'account' ? null : 'account'),
      }
      const action = digit >= 0 && CITIES[digit] ? () => s.selectCity(CITIES[digit].id) : run[key]
      if (!action) return
      e.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
