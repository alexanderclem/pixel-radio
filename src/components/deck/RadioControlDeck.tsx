import { ChevronDown, CloudRain, Maximize2, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'
import { focusController } from '../../focus/FocusController'
import { DEFAULT_AUDIO, useRadioStore, type AudioParams, type CrtParams } from '../../store/useRadioStore'
import { CitySelector } from './CitySelector'
import { Fader } from './Fader'
import { DeckButton, FocusButtons, FocusModule, FocusReadout } from './FocusModule'
import { Knob } from './Knob'
import { LedMeter } from './LedMeter'
import { ATMOS_FADERS, formatHz, formatWind, SKY_OPTIONS, WEATHER_OPTIONS } from './options'
import { StationDisplay } from './StationDisplay'
import { Segmented, ToggleSwitch } from './ToggleSwitch'
import { TuningDial } from './TuningDial'
import { Visualizer } from './Visualizer'

function Module({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`module relative flex min-w-0 flex-col gap-3 rounded-md p-3 pt-2 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h2 className="engraved font-pixel text-[8px] uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

const MIXER_KNOBS: { key: keyof AudioParams; label: string; format?: (v: number) => string; accent?: string }[] = [
  { key: 'master', label: 'Master', accent: '#ff4d6d' },
  { key: 'stream', label: 'Radio' },
  { key: 'staticBlend', label: 'Static' },
  { key: 'hiss', label: 'Hiss' },
  { key: 'cutoff', label: 'Lo-Pass', format: formatHz, accent: '#7df9ff' },
]

const CRT_TOGGLES: { key: Exclude<keyof CrtParams, 'enabled'>; label: string }[] = [
  { key: 'scanlines', label: 'Scan' },
  { key: 'aberration', label: 'Chroma' },
  { key: 'flicker', label: 'Flicker' },
  { key: 'curvature', label: 'Curve' },
]

/** The hi-fi faceplate: tuner, scope, mixer, atmosphere faders and FX/sky controls. */
/** The hi-fi faceplate. Compact by default (tuner, timer, volume); the full deck adds mixer, atmosphere and screen. */
export function RadioControlDeck({ onStep }: { onStep: (delta: number) => void }) {
  const audio = useRadioStore((s) => s.audio)
  const setAudio = useRadioStore((s) => s.setAudio)
  const geoMix = useRadioStore((s) => s.geoMix)
  const ambientLinked = useRadioStore((s) => s.ambientLinked)
  const setAmbientLinked = useRadioStore((s) => s.setAmbientLinked)
  const crt = useRadioStore((s) => s.crt)
  const fx = useRadioStore((s) => s.fx)
  const setFx = useRadioStore((s) => s.setFx)
  const setCrt = useRadioStore((s) => s.setCrt)
  const solarOverride = useRadioStore((s) => s.solarOverride)
  const setSolarOverride = useRadioStore((s) => s.setSolarOverride)
  const weather = useRadioStore((s) => s.weather)
  const setWeather = useRadioStore((s) => s.setWeather)
  const powered = useRadioStore((s) => s.powered)
  const stationCount = useRadioStore((s) => s.stationCount)
  const expanded = useRadioStore((s) => s.deckExpanded)
  const drawer = useRadioStore((s) => s.drawer)
  const setDrawer = useRadioStore((s) => s.setDrawer)
  const setDeckExpanded = useRadioStore((s) => s.setDeckExpanded)

  const toggle = (
    <button
      type="button"
      onClick={() => setDeckExpanded(!expanded)}
      aria-expanded={expanded}
      title={`${expanded ? 'Fewer' : 'All'} controls (C)`}
      className="flex items-center gap-1 rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2 py-1 font-term text-[15px] leading-none tracking-wider text-zinc-200 uppercase shadow-[0_2px_0_#000] hover:text-amber-300 active:translate-y-0.5 active:shadow-none"
    >
      {expanded ? <ChevronDown size={14} /> : <SlidersHorizontal size={14} />}
      {expanded ? 'Fewer controls' : 'All controls'}
    </button>
  )

  const grid = expanded
    ? 'md:grid-cols-2 xl:grid-cols-[minmax(0,4.2fr)_minmax(0,2.4fr)_minmax(0,2.6fr)_minmax(0,2.6fr)_minmax(0,2.8fr)] 2xl:grid-cols-[minmax(0,4.2fr)_minmax(0,2.6fr)_minmax(0,2.2fr)_minmax(0,2.6fr)_minmax(0,2.6fr)_minmax(0,2.8fr)]'
    : 'md:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_minmax(0,2.4fr)]'

  return (
    <div className="flex shrink-0 items-stretch">
      <div className="wood hidden w-4 shrink-0 sm:block" aria-hidden />
      <div className="brushed relative min-w-0 flex-1 p-3">
        {['top-1.5 left-1.5', 'top-1.5 right-1.5', 'bottom-1.5 left-1.5', 'bottom-1.5 right-1.5'].map((pos) => (
          <span key={pos} className={`screw absolute size-2.5 rounded-full ${pos}`} aria-hidden />
        ))}
        <div className={`grid grid-cols-1 gap-3 ${grid}`}>
          <Module
            title="Tuner"
            className="md:col-span-2 xl:col-span-1"
            aside={
              <span className="font-term text-[14px] leading-none text-zinc-400 tabular-nums">
                {stationCount > 0 ? `${stationCount.toLocaleString()} stations on map` : 'loading stations…'}
              </span>
            }
          >
            <StationDisplay onStep={onStep} />
            {expanded && <TuningDial />}
            <CitySelector compact={!expanded} />
          </Module>

          <Module title="Focus">
            {expanded ? (
              <FocusModule />
            ) : (
              <>
                <FocusReadout />
                <FocusButtons
                  extra={
                    <DeckButton label="Focus mode" hint="F" onClick={focusController.toggleMode}>
                      <Maximize2 size={15} />
                    </DeckButton>
                  }
                />
              </>
            )}
          </Module>

          {!expanded && (
            <Module title="Sound">
              <div className="flex items-start justify-around">
                <Knob label="Volume" value={audio.master} defaultValue={DEFAULT_AUDIO.master} onChange={(master) => setAudio({ master })} accent="#ff4d6d" size={44} />
                <Knob label="Radio" value={audio.stream} defaultValue={DEFAULT_AUDIO.stream} onChange={(stream) => setAudio({ stream })} size={44} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ToggleSwitch label="Calm" checked={fx.calm} onChange={(calm) => setFx({ calm })} color="#7df9ff" />
                <button
                  type="button"
                  onClick={() => setDrawer(drawer === 'moods' ? null : 'moods')}
                  aria-pressed={drawer === 'moods'}
                  title="Atmospheres (Y)"
                  className="flex items-center gap-1 rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 px-2 py-1 font-term text-[15px] leading-none tracking-wider text-zinc-200 uppercase shadow-[0_2px_0_#000] hover:text-amber-300 active:translate-y-0.5 active:shadow-none aria-pressed:text-amber-300"
                >
                  <CloudRain size={14} /> Moods
                </button>
                {toggle}
              </div>
            </Module>
          )}

          {expanded && (
            <>
              {/* Five columns fit at xl, so the decorative monitor waits for 2xl there */}
              <Module title="Monitor" className="xl:hidden 2xl:flex">
                <Visualizer active={powered} />
                <LedMeter active={powered} />
              </Module>

              <Module title="Mixer">
                <div className="grid grid-cols-3 justify-items-center gap-x-1 gap-y-2">
                  {MIXER_KNOBS.map(({ key, label, format, accent }) => (
                    <Knob
                      key={key}
                      label={label}
                      value={audio[key]}
                      defaultValue={DEFAULT_AUDIO[key]}
                      onChange={(v) => setAudio({ [key]: v })}
                      format={format}
                      accent={accent}
                      size={50}
                    />
                  ))}
                </div>
              </Module>

              <Module title="Atmosphere">
                <div className="flex justify-between gap-1">
                  {ATMOS_FADERS.map(({ key, label }) => (
                    <Fader
                      key={key}
                      label={label}
                      value={audio[key]}
                      onChange={(v) => setAudio({ [key]: v })}
                      geo={key !== 'pad' && ambientLinked ? geoMix[key] : undefined}
                    />
                  ))}
                </div>
                <ToggleSwitch label="Geo Link" checked={ambientLinked} onChange={setAmbientLinked} />
              </Module>

              <Module title="Sky & Screen" aside={toggle}>
                <Segmented label="Solar cycle" value={solarOverride} options={SKY_OPTIONS} onChange={setSolarOverride} />
                <Segmented
                  label="Weather"
                  value={weather.mode}
                  options={WEATHER_OPTIONS}
                  onChange={(mode) => setWeather({ mode })}
                  columns={3}
                />
                <div className="flex items-end justify-around">
                  <Knob label="Density" value={weather.density} defaultValue={0.5} onChange={(density) => setWeather({ density })} size={40} />
                  <Knob
                    label="Wind"
                    value={weather.wind}
                    defaultValue={0.5}
                    onChange={(wind) => setWeather({ wind })}
                    format={formatWind}
                    size={40}
                    accent="#7df9ff"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <ToggleSwitch label="Calm" checked={fx.calm} onChange={(calm) => setFx({ calm })} color="#7df9ff" />
                  <ToggleSwitch label="CRT" checked={crt.enabled} onChange={(enabled) => setCrt({ enabled })} color="#ff4d6d" />
                  {CRT_TOGGLES.map(({ key, label }) => (
                    <ToggleSwitch
                      key={key}
                      label={label}
                      checked={crt[key]}
                      disabled={!crt.enabled}
                      onChange={(v) => setCrt({ [key]: v })}
                    />
                  ))}
                </div>
              </Module>
            </>
          )}
        </div>
      </div>
      <div className="wood hidden w-4 shrink-0 sm:block" aria-hidden />
    </div>
  )
}
