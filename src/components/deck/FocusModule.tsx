import { Maximize2, Minus, Pause, Play, Plus, RotateCcw, SkipForward } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { focusController, isPaused } from '../../focus/FocusController'
import { useFocusRemaining } from '../../hooks/useFocusTimer'
import { useRadioStore, type FocusSettings } from '../../store/useRadioStore'
import { formatCountdown } from '../../utils/time'
import { Segmented, ToggleSwitch } from './ToggleSwitch'

const PRESETS: { value: string; label: string; settings: Pick<FocusSettings, 'work' | 'short' | 'long'> }[] = [
  { value: '25', label: '25/5', settings: { work: 25, short: 5, long: 15 } },
  { value: '50', label: '50/10', settings: { work: 50, short: 10, long: 20 } },
  { value: '90', label: '90/20', settings: { work: 90, short: 20, long: 30 } },
]

/** Phase label, countdown and session dots on the green LCD. */
export function FocusReadout({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const focus = useRadioStore((s) => s.focus)
  const remaining = useFocusRemaining()
  const paused = isPaused(focus)
  const label =
    focus.phase === 'idle' ? 'READY' : focus.phase === 'focus' ? 'FOCUS' : focus.longBreak ? 'LONG BREAK' : 'BREAK'
  const set = focus.settings.longEvery
  const filled = focus.completed % set || (focus.completed > 0 && focus.phase === 'break' ? set : 0)
  const color = focus.phase === 'break' ? 'text-cyan' : 'text-lcd'

  return (
    <div className={`lcd flex items-center justify-between gap-3 rounded-[3px] px-3 py-2 font-term ${color}`}>
      <div className="min-w-0">
        <div className="text-[15px] leading-none tracking-widest text-lcd-dim">
          {label}
          {paused && <span className="text-glow"> · PAUSED</span>}
        </div>
        <div
          role="timer"
          aria-label={`${label} ${formatCountdown(remaining)} remaining`}
          className={`glow-text leading-none tabular-nums ${size === 'lg' ? 'text-[56px]' : 'text-[38px]'} ${paused ? 'opacity-60' : ''}`}
        >
          {formatCountdown(remaining)}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-[14px] leading-none text-lcd-dim">
        <div className="flex gap-1" aria-label={`${focus.completed % set} of ${set} sessions in this set`}>
          {Array.from({ length: set }, (_, i) => (
            <span key={i} className={`size-2 rounded-full ${i < filled ? 'bg-lcd shadow-[0_0_6px_#7dffa8]' : 'bg-lcd-dim/40'}`} />
          ))}
        </div>
        <span className="tabular-nums">{focus.completed} today</span>
      </div>
    </div>
  )
}

/** Start/pause, skip and reset, used on the deck and in the focus bar. */
export function FocusButtons({ extra, compact }: { extra?: ReactNode; compact?: boolean }) {
  const focus = useRadioStore((s) => s.focus)
  const running = focus.phase !== 'idle' && !isPaused(focus)
  return (
    <div className="flex gap-1.5">
      <DeckButton
        label={focus.phase === 'idle' ? 'Start focus session' : running ? 'Pause timer' : 'Resume timer'}
        hint="T"
        onClick={focusController.toggle}
        primary
      >
        {running ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        <span className={compact ? 'xl:max-2xl:hidden' : ''}>{focus.phase === 'idle' ? 'START' : running ? 'PAUSE' : 'RESUME'}</span>
      </DeckButton>
      <DeckButton label={focus.phase === 'break' ? 'End break' : 'Skip to break'} onClick={focusController.skip} disabled={focus.phase === 'idle'}>
        <SkipForward size={15} fill="currentColor" />
      </DeckButton>
      <DeckButton label="Reset timer" onClick={focusController.reset} disabled={focus.phase === 'idle'}>
        <RotateCcw size={15} />
      </DeckButton>
      {extra}
    </div>
  )
}

export function DeckButton({ label, hint, onClick, disabled, primary, children }: {
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-8 items-center justify-center gap-1.5 rounded-[3px] border border-black px-2.5 font-term text-[16px] leading-none tracking-wider shadow-[0_2px_0_#000] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40 ${
        primary
          ? 'flex-1 bg-gradient-to-b from-amber-300 to-amber-500 text-black'
          : 'bg-gradient-to-b from-zinc-600 to-zinc-800 text-zinc-200 hover:text-amber-300'
      }`}
    >
      {children}
    </button>
  )
}

function Stepper({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  const btn = 'grid size-6 place-items-center rounded-[2px] border border-black bg-zinc-700 text-zinc-200 hover:text-amber-300 disabled:opacity-40'
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="engraved font-term text-[12px] leading-none uppercase">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} aria-label={`Shorter ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
          <Minus size={12} />
        </button>
        <span className="w-7 text-center font-term text-[17px] leading-none text-lcd tabular-nums">{value}</span>
        <button type="button" className={btn} aria-label={`Longer ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
          <Plus size={12} />
        </button>
      </div>
    </div>
  )
}

/** Deck module: Pomodoro timer with presets, chime/duck options and the focus-mode switch. */
export function FocusModule() {
  const settings = useRadioStore((s) => s.focus.settings)
  const setFocusSettings = useRadioStore((s) => s.setFocusSettings)
  const [custom, setCustom] = useState(false)
  const preset = PRESETS.find((p) => p.settings.work === settings.work && p.settings.short === settings.short && p.settings.long === settings.long)
  const choice = custom || !preset ? 'custom' : preset.value

  const enableNotify = async (on: boolean) => {
    if (!on || typeof Notification === 'undefined') return setFocusSettings({ notify: false })
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    setFocusSettings({ notify: permission === 'granted' })
  }

  return (
    <>
      <FocusReadout />
      <FocusButtons
        compact
        extra={
          <DeckButton label="Focus mode" hint="F" onClick={focusController.toggleMode}>
            <Maximize2 size={15} />
          </DeckButton>
        }
      />
      <Segmented
        label="Focus / break (min)"
        value={choice}
        options={[...PRESETS.map(({ value, label }) => ({ value, label })), { value: 'custom', label: 'Custom' }]}
        onChange={(v) => {
          const next = PRESETS.find((p) => p.value === v)
          setCustom(!next)
          if (next) setFocusSettings(next.settings)
        }}
      />
      {choice === 'custom' && (
        <div className="flex justify-around">
          <Stepper label="Focus" value={settings.work} min={5} max={180} step={5} onChange={(work) => setFocusSettings({ work })} />
          <Stepper label="Break" value={settings.short} min={1} max={60} step={1} onChange={(short) => setFocusSettings({ short })} />
          <Stepper label="Long" value={settings.long} min={5} max={90} step={5} onChange={(long) => setFocusSettings({ long })} />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <ToggleSwitch label="Chime" checked={settings.chime} onChange={(chime) => setFocusSettings({ chime })} />
        <ToggleSwitch label="Quiet breaks" checked={settings.duckOnBreak} onChange={(duckOnBreak) => setFocusSettings({ duckOnBreak })} />
        <ToggleSwitch label="Notify" checked={settings.notify} onChange={(on) => void enableNotify(on)} />
      </div>
    </>
  )
}
