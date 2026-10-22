import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { SHORTCUTS } from '../constants/shortcuts'
import { useRadioStore } from '../store/useRadioStore'

/** Keyboard reference, opened with "?" or the header help button. */
export function ShortcutsHelp() {
  const setHelpOpen = useRadioStore((s) => s.setHelpOpen)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])

  return (
    <motion.div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={(e) => e.target === e.currentTarget && setHelpOpen(false)}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" className="brushed w-full max-w-lg rounded-lg p-1.5">
        <div className="lcd rounded-md p-4 font-term text-lcd">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="shortcuts-title" className="font-pixel text-[11px] text-glow">KEYBOARD</h2>
            <button
              ref={close}
              type="button"
              aria-label="Close"
              onClick={() => setHelpOpen(false)}
              className="grid size-7 place-items-center rounded-[3px] text-lcd-dim hover:text-lcd focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {SHORTCUTS.map(({ group, keys }) => (
              <section key={group}>
                <h3 className="mb-1 text-[15px] tracking-widest text-lcd-dim uppercase">{group}</h3>
                <dl className="flex flex-col gap-1">
                  {keys.map(({ keys: k, label }) => (
                    <div key={label} className="flex items-center justify-between gap-3 text-[17px] leading-tight">
                      <dt className="flex shrink-0 gap-1">
                        {k.map((key) =>
                          key === '…' ? (
                            <span key={key}>…</span>
                          ) : (
                            <kbd key={key} className="min-w-6 rounded-[2px] border border-lcd-dim/60 px-1 text-center text-[15px] text-lcd">
                              {key}
                            </kbd>
                          ),
                        )}
                      </dt>
                      <dd className="text-right text-lcd/80">{label}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
