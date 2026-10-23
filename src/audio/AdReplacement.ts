import { create } from 'zustand'

/** Deliberately match break labels, never words inside song/artist names. */
export function isAdMarker(title: string): boolean {
  return /^(?:ad(?:vert(?:isement)?)?s?|commercials?|commercial break|ad break|advertisement break|paid advertisement)(?:\s*[:|]\s*.*)?$/i.test(title.trim())
}

export const useAdReplacement = create<{
  enabled: boolean
  replacing: boolean
  setEnabled: (enabled: boolean) => void
}>((set) => ({
  enabled: false,
  replacing: false,
  setEnabled: (enabled) => set({ enabled }),
}))

/** Bounded, metadata-based replacement; the live stream is never paused. */
export class AdReplacement {
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastTitle: string | null = null
  private apply: (replacing: boolean) => void
  private maxMs: number
  constructor(apply: (replacing: boolean) => void, maxMs = 180_000) {
    this.apply = apply
    this.maxMs = maxMs
  }

  connect() {
    const unsubscribe = useAdReplacement.subscribe((next, prev) => {
      if (next.enabled !== prev.enabled) {
        this.restore()
        if (next.enabled && this.lastTitle && isAdMarker(this.lastTitle)) this.start()
      }
    })
    return () => { unsubscribe(); this.reset() }
  }

  title(title: string) {
    if (title === this.lastTitle) return
    this.lastTitle = title
    if (useAdReplacement.getState().enabled && isAdMarker(title)) this.start()
    else this.restore()
  }

  replaceNow() {
    if (useAdReplacement.getState().enabled) this.start()
  }

  restore() {
    clearTimeout(this.timer)
    this.timer = undefined
    this.apply(false)
    useAdReplacement.setState({ replacing: false })
  }

  reset() {
    this.lastTitle = null
    this.restore()
  }

  private start() {
    // Repeated markers must not extend the safety limit indefinitely.
    if (this.timer !== undefined) return
    this.apply(true)
    useAdReplacement.setState({ replacing: true })
    this.timer = setTimeout(() => this.restore(), this.maxMs)
  }
}
