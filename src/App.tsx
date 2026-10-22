import { Power } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { PixelCanvas } from './components/PixelCanvas'
import { PowerOnScreen } from './components/PowerOnScreen'
import { RadioControlDeck } from './components/deck/RadioControlDeck'
import { useAudioEngine } from './hooks/useAudioEngine'
import { isCalm, useRadioStore } from './store/useRadioStore'

export default function App() {
  const { powerOn, powerOff, stepStation } = useAudioEngine()
  const powered = useRadioStore((s) => s.powered)
  const calm = useRadioStore(isCalm)

  return (
    <div className="flex min-h-dvh flex-col bg-ink xl:h-dvh" data-calm={calm || undefined}>
      <header className="flex items-center justify-between gap-4 px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="font-pixel text-[13px] text-glow glow-text">PIXEL RADIO</h1>
          <span className="hidden font-term text-[17px] text-zinc-500 sm:inline">world receiver · model PR-88</span>
        </div>
        <button
          type="button"
          onClick={() => (powered ? powerOff() : powerOn())}
          aria-pressed={powered}
          className="flex items-center gap-2 rounded-[3px] border border-black bg-gradient-to-b from-zinc-700 to-zinc-900 px-3 py-1 font-term text-[16px] tracking-wider text-zinc-300 shadow-[0_2px_0_#000] transition active:translate-y-0.5 active:shadow-none"
        >
          <span
            className="size-2 rounded-full"
            style={{ background: powered ? '#ff4d6d' : '#3a1820', boxShadow: powered ? '0 0 8px #ff4d6d' : 'none' }}
          />
          <Power size={14} strokeWidth={3} />
          {powered ? 'ON' : 'OFF'}
        </button>
      </header>

      <main className="relative h-[58vh] shrink-0 px-3 pb-3 xl:h-auto xl:min-h-0 xl:flex-1">
        <div className="h-full overflow-hidden rounded-xl border-4 border-black bg-black shadow-[0_0_0_3px_#2a2933,0_10px_30px_rgb(0_0_0/0.6)]">
          <PixelCanvas />
        </div>
      </main>

      <RadioControlDeck onStep={stepStation} />

      <AnimatePresence>{!powered && <PowerOnScreen onPower={powerOn} />}</AnimatePresence>
    </div>
  )
}
