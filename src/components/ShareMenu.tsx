import { Image, Link, Save, Share2, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { stationLink } from '../routing/deepLink'
import { currentSetup, sessionLink } from '../session/play'
import { canShareNatively, copyText, shareStationImage, shareStationLink } from '../share/share'
import { useRadioStore } from '../store/useRadioStore'

const item =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left font-term text-[17px] leading-none text-zinc-200 hover:bg-zinc-700 hover:text-amber-300 focus-visible:bg-zinc-700 focus-visible:outline-none'

/** Share the playing station: a link to it, or a picture of the map with what's on. */
export function ShareMenu({ className }: { className: string }) {
  const station = useRadioStore((s) => (s.tuneStatus === 'playing' ? s.station : null))
  const powered = useRadioStore((s) => s.powered)
  const setDrawer = useRadioStore((s) => s.setDrawer)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
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

  const run = (action: () => Promise<unknown>) => async () => {
    setOpen(false)
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={root} className="relative flex flex-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={!powered || !station || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share this station"
        title="Share this station"
        className={className}
      >
        <Share2 size={15} />
      </button>
      {open && station && (
        <div role="menu" className="absolute right-full bottom-0 z-30 mr-1.5 w-56 overflow-hidden rounded-[3px] border border-black bg-zinc-800 py-1 shadow-[0_4px_0_#000]">
          {canShareNatively() && (
            <button type="button" role="menuitem" className={item} onClick={run(() => shareStationLink(station))}>
              <Share2 size={14} /> Share link…
            </button>
          )}
          <button type="button" role="menuitem" className={item} onClick={run(() => copyText(stationLink(station.id), 'Link copied'))}>
            <Link size={14} /> Copy station link
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={run(async () => {
              const setup = currentSetup()
              if (setup) await copyText(sessionLink(setup), 'Session link copied: station, map, weather and sound')
            })}
          >
            <SlidersHorizontal size={14} /> Copy session link
          </button>
          <button type="button" role="menuitem" className={item} onClick={run(() => shareStationImage(station))}>
            <Image size={14} /> Share as image
          </button>
          <button type="button" role="menuitem" className={item} onClick={run(async () => setDrawer('favorites'))}>
            <Save size={14} /> Save this setup…
          </button>
        </div>
      )}
    </div>
  )
}
