import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useRadioStore } from '../store/useRadioStore'

const SHOW_MS = 3500

/** One short notice at a time, above the deck. */
export function Toast() {
  const toast = useRadioStore((s) => s.toast)
  const [visible, setVisible] = useState<typeof toast>(null)

  useEffect(() => {
    if (!toast) return
    setVisible(toast)
    const id = window.setTimeout(() => setVisible(null), SHOW_MS)
    return () => window.clearTimeout(id)
  }, [toast])

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <AnimatePresence>
        {visible && (
          <motion.div
            key={visible.nonce}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="lcd max-w-md rounded-[3px] border border-black px-4 py-2 font-term text-[18px] leading-tight text-lcd shadow-[0_4px_0_#000]"
          >
            {visible.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
