import { Keyboard, ListMusic, Maximize2, Power, type LucideIcon } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import type { ReactNode } from 'react'
import { FocusBar } from './components/FocusBar'
import { PixelCanvas } from './components/PixelCanvas'
import { PowerOnScreen } from './components/PowerOnScreen'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { StationsDrawer } from './components/StationsDrawer'
import { RadioControlDeck } from './components/deck/RadioControlDeck'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useFocusTimer } from './hooks/useFocusTimer'
import { useShortcuts } from './hooks/useShortcuts'
import { isCalm, useRadioStore } from './store/useRadioStore'

export default function App() {
  const { powerOn, powerOff, stepStation } = useAudioEngine()
  const focus = useFocusTimer()
  const powered = useRadioStore((s) => s.powered)
  const calm = useRadioStore(isCalm)
  const focusMode = useRadioStore((s) => s.focus.mode)
  const drawer = useRadioStore((s) => s.drawer)
  const setDrawer = useRadioStore((s) => s.setDrawer)
  const helpOpen = useRadioStore((s) => s.helpOpen)
  const setHelpOpen = useRadioStore((s) => s.setHelpOpen)
  useShortcuts({ stepStation, toggleTimer: focus.toggle, toggleFocusMode: focus.toggleMode })

  return (
    <div className="flex min-h-dvh flex-col bg-ink xl:h-dvh" data-calm={calm || undefined}>
      <header className="flex items-center justify-between gap-4 px-4 py-2">
        <div className="flex items-baseline gap-3">
          <h1 className="font-pixel text-[13px] whitespace-nowrap text-glow glow-text">PIXEL RADIO</h1>
          <span className="hidden font-term text-[17px] text-zinc-500 sm:inline">
            {focusMode ? 'focus mode · esc to leave' : 'world receiver · model PR-88'}
          </span>
        </div>
        <nav aria-label="App" className="flex items-center gap-1.5">
          {!focusMode && (
            <>
              <HeaderButton
                label="Stations"
                hint="D"
                icon={ListMusic}
                pressed={drawer === 'favorites' || drawer === 'recent'}
                onClick={() => setDrawer(drawer === 'favorites' || drawer === 'recent' ? null : 'favorites')}
              />
              <HeaderButton label="Focus mode" hint="F" icon={Maximize2} onClick={focus.toggleMode} />
            </>
          )}
          <HeaderButton label="Keyboard shortcuts" hint="?" icon={Keyboard} pressed={helpOpen} onClick={() => setHelpOpen(!helpOpen)} iconOnly />
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
        </nav>
      </header>

      <main className={`relative shrink-0 px-3 pb-3 xl:h-auto xl:min-h-0 xl:flex-1 ${focusMode ? 'h-[64vh]' : 'h-[58vh]'}`}>
        <div className="h-full overflow-hidden rounded-xl border-4 border-black bg-black shadow-[0_0_0_3px_#2a2933,0_10px_30px_rgb(0_0_0/0.6)]">
          <PixelCanvas />
        </div>
      </main>

      {focusMode ? <FocusBar onStep={stepStation} /> : <RadioControlDeck onStep={stepStation} />}

      <AnimatePresence>{drawer && <StationsDrawer key="drawer" tab={drawer} />}</AnimatePresence>
      <AnimatePresence>{!powered && <PowerOnScreen onPower={powerOn} />}</AnimatePresence>
      <AnimatePresence>{helpOpen && <ShortcutsHelp key="help" />}</AnimatePresence>
    </div>
  )
}

function HeaderButton({ label, hint, icon: Icon, onClick, pressed, iconOnly, badge }: {
  label: string
  hint: string
  icon: LucideIcon
  onClick: () => void
  pressed?: boolean
  iconOnly?: boolean
  badge?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={`${label} (${hint})`}
      className="relative flex items-center gap-2 rounded-[3px] border border-black bg-gradient-to-b from-zinc-700 to-zinc-900 px-2.5 py-1 font-term text-[16px] tracking-wider text-zinc-300 shadow-[0_2px_0_#000] transition hover:text-amber-300 active:translate-y-0.5 active:shadow-none aria-pressed:text-amber-300"
    >
      <Icon size={14} strokeWidth={2.5} />
      {!iconOnly && <span className="hidden uppercase md:inline">{label}</span>}
      {badge}
    </button>
  )
}
