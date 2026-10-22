import { Power } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'

/** Gate that collects the user gesture the AudioContext needs, then collapses like a CRT. */
export function PowerOnScreen({ onPower }: { onPower: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await onPower()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { delay: 0.35, duration: 0.25 } }}
    >
      <motion.div
        className="brushed w-full max-w-md rounded-lg p-1.5"
        exit={{ scaleY: [1, 0.012, 0.012], scaleX: [1, 1, 0], transition: { duration: 0.5, times: [0, 0.6, 1] } }}
      >
        <div className="lcd flex flex-col items-center gap-5 rounded-md px-6 py-8 text-center">
          <h1 className="font-pixel text-[22px] leading-tight text-glow glow-text">
            PIXEL
            <br />
            RADIO
          </h1>
          <p className="font-term text-[20px] leading-snug text-lcd">
            Every public radio station on a pixel planet, with a generative ambient synth and weather that moves with
            you.
          </p>
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="group flex items-center gap-3 rounded-md border-2 border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-6 py-3 font-pixel text-[12px] text-zinc-100 shadow-[0_4px_0_#000] transition hover:text-amber-300 active:translate-y-1 active:shadow-none disabled:opacity-60"
          >
            <Power size={18} strokeWidth={3} className="text-hot drop-shadow-[0_0_6px_#ff4d6d]" />
            {busy ? 'WARMING UP…' : 'POWER ON'}
          </button>
          <p className="font-term text-[16px] leading-tight text-lcd-dim">
            Drag to pan · scroll to zoom · click any dot to tune in
            <br />
            Press ? for keyboard shortcuts · headphones recommended
          </p>
          {error && (
            <p role="alert" className="font-term text-[16px] text-hot">
              Audio failed to start: {error}
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
