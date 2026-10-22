import type { ReactNode } from 'react'
import { CUTOFF_MAX, CUTOFF_MIN } from '../../constants/audio'
import { DEFAULT_AUDIO, useRadioStore, type AudioParams, type CrtParams, type WeatherControls } from '../../store/useRadioStore'
import type { SolarPhase } from '../../types'
import { CitySelector } from './CitySelector'
import { Fader } from './Fader'
import { Knob } from './Knob'
import { LedMeter } from './LedMeter'
import { StationDisplay } from './StationDisplay'
import { StationSearch } from './StationSearch'
import { Segmented, ToggleSwitch } from './ToggleSwitch'
import { TuningDial } from './TuningDial'
import { Visualizer } from './Visualizer'

function Module({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`module relative flex flex-col gap-3 rounded-md p-3 pt-2 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="engraved font-pixel text-[8px] uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

const formatHz = (v: number) => {
  const hz = CUTOFF_MIN * Math.pow(CUTOFF_MAX / CUTOFF_MIN, v)
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${Math.round(hz)}`
}

const MIXER_KNOBS: { key: keyof AudioParams; label: string; format?: (v: number) => string; accent?: string }[] = [
  { key: 'master', label: 'Master', accent: '#ff4d6d' },
  { key: 'stream', label: 'Radio' },
  { key: 'staticBlend', label: 'Static' },
  { key: 'hiss', label: 'Hiss' },
  { key: 'cutoff', label: 'Lo-Pass', format: formatHz, accent: '#7df9ff' },
]

const ATMOS_FADERS: { key: 'pad' | 'rain' | 'wind' | 'city' | 'fire'; label: string }[] = [
  { key: 'pad', label: 'Pad' },
  { key: 'rain', label: 'Rain' },
  { key: 'wind', label: 'Wind' },
  { key: 'city', label: 'City' },
  { key: 'fire', label: 'Fire' },
]

const CRT_TOGGLES: { key: Exclude<keyof CrtParams, 'enabled'>; label: string }[] = [
  { key: 'scanlines', label: 'Scan' },
  { key: 'aberration', label: 'Chroma' },
  { key: 'flicker', label: 'Flicker' },
  { key: 'curvature', label: 'Curve' },
]

const SKY_OPTIONS: { value: 'auto' | SolarPhase; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'day', label: 'Day' },
  { value: 'golden', label: 'Gold' },
  { value: 'night', label: 'Night' },
  { value: 'aurora', label: 'Aurora' },
]

const WEATHER_OPTIONS: { value: WeatherControls['mode']; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'clear', label: 'Clear' },
  { value: 'rain', label: 'Rain' },
  { value: 'storm', label: 'Storm' },
  { value: 'snow', label: 'Snow' },
  { value: 'embers', label: 'Embers' },
]

/** The hi-fi faceplate: tuner, scope, mixer, atmosphere faders and FX/sky controls. */
export function RadioControlDeck({ onStep }: { onStep: (delta: number) => void }) {
  const audio = useRadioStore((s) => s.audio)
  const setAudio = useRadioStore((s) => s.setAudio)
  const geoMix = useRadioStore((s) => s.geoMix)
  const ambientLinked = useRadioStore((s) => s.ambientLinked)
  const setAmbientLinked = useRadioStore((s) => s.setAmbientLinked)
  const crt = useRadioStore((s) => s.crt)
  const setCrt = useRadioStore((s) => s.setCrt)
  const solarOverride = useRadioStore((s) => s.solarOverride)
  const setSolarOverride = useRadioStore((s) => s.setSolarOverride)
  const weather = useRadioStore((s) => s.weather)
  const setWeather = useRadioStore((s) => s.setWeather)
  const powered = useRadioStore((s) => s.powered)
  const stationCount = useRadioStore((s) => s.stationCount)

  return (
    <div className="flex shrink-0 items-stretch">
      <div className="wood hidden w-4 shrink-0 sm:block" aria-hidden />
      <div className="brushed relative flex-1 p-3">
        {['top-1.5 left-1.5', 'top-1.5 right-1.5', 'bottom-1.5 left-1.5', 'bottom-1.5 right-1.5'].map((pos) => (
          <span key={pos} className={`screw absolute size-2.5 rounded-full ${pos}`} aria-hidden />
        ))}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,4.2fr)_minmax(0,2.4fr)_minmax(0,2.6fr)_minmax(0,2.6fr)_minmax(0,2.8fr)]">
          <Module
            title="Tuner"
            className="md:col-span-2 xl:col-span-1"
            aside={
              <span className="font-term text-[14px] leading-none text-zinc-500 tabular-nums">
                {stationCount > 0 ? `${stationCount.toLocaleString()} stations on map` : 'loading stations…'}
              </span>
            }
          >
            <StationSearch />
            <StationDisplay onStep={onStep} />
            <TuningDial />
            <CitySelector />
          </Module>

          <Module title="Monitor">
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

          <Module title="Sky & Screen">
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
                format={(v) => `${v < 0.5 ? '◀' : v > 0.5 ? '▶' : ''}${Math.round(Math.abs(v - 0.5) * 200)}`}
                size={40}
                accent="#7df9ff"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
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
        </div>
      </div>
      <div className="wood hidden w-4 shrink-0 sm:block" aria-hidden />
    </div>
  )
}
