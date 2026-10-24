import { Moon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { sleepController, useSleepRemaining } from '../hooks/useSleepTimer'
import { SLEEP_MINUTES } from '../sleep/SleepController'
import { useRadioStore } from '../store/useRadioStore'
import { formatCountdown } from '../utils/time'

const item =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left font-term text-[17px] leading-none text-zinc-200 hover:bg-zinc-700 hover:text-amber-300 focus-visible:bg-zinc-700 focus-visible:outline-none aria-checked:text-amber-300'

/** Moon button: pick when the radio fades out and turns off, and see how long is left. */
export function SleepButton({ className, up = true }: { className: string; up?: boolean }) {
  const sleep = useRadioStore((s) => s.sleep)
  const powered = useRadioStore((s) => s.powered)
  const left = useSleepRemaining()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const choose = (action: () => void) => () => {
    action()
    setOpen(false)
  }
  const on = sleep.mode !== 'off'
  const readout = left !== null ? formatCountdown(left) : sleep.mode === 'focus-end' ? 'END' : null

  return (
    <div ref={root} className="relative flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={!powered}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={on ? `Sleep timer: ${readout === 'END' ? 'after this focus session' : `${readout} left`}` : 'Sleep timer'}
        title="Sleep timer (Z)"
        className={`${className} ${on ? 'text-amber-300' : ''}`}
      >
        <Moon size={15} fill={on ? 'currentColor' : 'none'} />
        {readout && <span className="tabular-nums">{readout}</span>}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Sleep timer"
          className={`absolute right-0 z-30 w-60 overflow-hidden rounded-[3px] border border-black bg-zinc-800 py-1 shadow-[0_4px_0_#000] ${up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          <p className="px-3 pt-1 pb-1.5 font-read text-[12px] leading-snug text-zinc-400">Fades out, then turns the radio off.</p>
          {SLEEP_MINUTES.map((m) => (
            <button key={m} type="button" role="menuitemradio" aria-checked={false} className={item} onClick={choose(() => sleepController.start(m))}>
              {m} minutes
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={sleep.mode === 'focus-end'}
            className={item}
            onClick={choose(sleepController.atFocusEnd)}
          >
            End of focus session
          </button>
          {on && (
            <button type="button" role="menuitem" className={`${item} border-t border-black/60 text-zinc-400`} onClick={choose(sleepController.cancel)}>
              Turn sleep timer off
            </button>
          )}
        </div>
      )}
    </div>
  )
}
