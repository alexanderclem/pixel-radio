import { Minimize2, SkipBack, SkipForward } from 'lucide-react'
import { focusController } from '../focus/FocusController'
import { currentSong, DEFAULT_AUDIO, useRadioStore } from '../store/useRadioStore'
import { DeckButton, FocusButtons, FocusReadout, sleepClass } from './deck/FocusModule'
import { SleepButton } from './SleepButton'
import { Knob } from './deck/Knob'

/** Focus mode's only control strip: the timer, what's playing, volume and a way out. */
export function FocusBar({ onStep }: { onStep: (delta: number) => void }) {
  const station = useRadioStore((s) => s.station)
  const statusText = useRadioStore((s) => s.statusText)
  const song = useRadioStore(currentSong)
  const stations = useRadioStore((s) => s.stations)
  const master = useRadioStore((s) => s.audio.master)
  const setAudio = useRadioStore((s) => s.setAudio)

  return (
    <div className="brushed flex shrink-0 flex-wrap items-center gap-3 p-3">
      <div className="flex min-w-[16rem] flex-1 flex-col gap-1.5 sm:max-w-sm">
        <FocusReadout size="lg" />
        <FocusButtons />
      </div>

      <div className="lcd flex min-w-[14rem] flex-[2] items-center gap-2 rounded-[3px] px-3 py-2 font-term text-lcd">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-none tracking-widest text-lcd-dim">NOW PLAYING</div>
          <div className="glow-text truncate text-[22px] leading-tight">{station?.name ?? statusText}</div>
          <div className="truncate text-[15px] leading-tight text-lcd-dim">{song ? `♪ ${song}` : station ? station.location : ''}</div>
        </div>
        <DeckButton label="Previous station" hint="B" onClick={() => onStep(-1)} disabled={!stations.length}>
          <SkipBack size={15} fill="currentColor" />
        </DeckButton>
        <DeckButton label="Next station" hint="N" onClick={() => onStep(1)} disabled={!stations.length}>
          <SkipForward size={15} fill="currentColor" />
        </DeckButton>
      </div>

      <div className="flex items-center gap-3">
        <SleepButton className={sleepClass} />
        <Knob label="Volume" value={master} defaultValue={DEFAULT_AUDIO.master} onChange={(v) => setAudio({ master: v })} size={48} accent="#ff4d6d" />
        <DeckButton label="Leave focus mode" hint="Esc" onClick={focusController.toggleMode}>
          <Minimize2 size={15} />
          <span>EXIT</span>
        </DeckButton>
      </div>
    </div>
  )
}
