import { Check, Play, Save, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CITIES } from '../constants/cities'
import { customToAtmosphere, makeMood, type MoodDraft } from '../session/moods'
import { applySettings, playAtmosphere } from '../session/play'
import { cleanTags, MIX_KEYS, type MoodSettings, type SoundMix, type StationPick } from '../session/setup'
import { useRadioStore } from '../store/useRadioStore'
import { Fader } from './deck/Fader'
import { Knob } from './deck/Knob'
import { ATMOS_FADERS, formatHz, formatWind, SKY_OPTIONS, WEATHER_OPTIONS } from './deck/options'
import { Segmented, ToggleSwitch } from './deck/ToggleSwitch'
import { button, input } from './DrawerRow'

/** Plainer text fields than the name, for longer or numeric values */
const field =
  'min-w-0 rounded-[3px] border border-black bg-black/60 px-2 py-1 font-read text-[13px] leading-none text-lcd shadow-[inset_0_1px_3px_#000] placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 disabled:opacity-40'
const heading = 'engraved font-term text-[12px] leading-none uppercase'
const hint = 'font-read text-[11px] leading-snug text-zinc-500'

const MUSIC: { kind: StationPick['kind']; label: string; hint: string }[] = [
  { kind: 'keep', label: "Keep what's playing", hint: 'Only the scene changes; the station stays on.' },
  { kind: 'tag', label: 'A genre', hint: 'Finds a popular station for it, anywhere in the world.' },
  { kind: 'city', label: 'A city', hint: 'Finds a station near it and flies the map there.' },
]

const GENRES = ['jazz', 'lofi', 'ambient', 'classical', 'folk', 'soul', 'bossa nova', 'electronic']

const DEFAULT_TIMER = { work: 25, short: 5 }

type Scene = Pick<MoodSettings, 'weather' | 'sky' | 'mix'>

/** What was on before editing, to put back if the edit is cancelled. */
function snapshot() {
  const s = useRadioStore.getState()
  return {
    scene: { weather: { ...s.weather }, sky: s.solarOverride, mix: Object.fromEntries(MIX_KEYS.map((k) => [k, s.audio[k]])) as SoundMix },
    ambientLinked: s.ambientLinked,
    atmosphere: s.atmosphere,
  }
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-[3px] border border-black/60 bg-black/20 p-2">
      <legend className={`${heading} px-1`}>{title}</legend>
      {note && <p className={hint}>{note}</p>}
      {children}
    </fieldset>
  )
}

const clampInt = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && v !== '' ? Math.min(max, Math.max(min, n)) : fallback
}

/**
 * Make or change a mood. The scene plays as you edit (weather, sky and sounds go straight
 * to the map and mixer); Cancel, or leaving the tab, puts back what was on before.
 */
export function MoodEditor({ initial, onDone }: { initial: MoodDraft; onDone: () => void }) {
  const saveMood = useRadioStore((s) => s.saveMood)
  const removeMood = useRadioStore((s) => s.removeMood)
  const setAtmosphere = useRadioStore((s) => s.setAtmosphere)
  const showToast = useRadioStore((s) => s.showToast)
  const selectedCityId = useRadioStore((s) => s.selectedCityId)

  const [name, setName] = useState(initial.name)
  const [tagline, setTagline] = useState(initial.tagline)
  const [kind, setKind] = useState(initial.pick.kind)
  const [tagText, setTagText] = useState(initial.pick.kind === 'tag' ? initial.pick.tags.join(', ') : '')
  const [cityId, setCityId] = useState(initial.pick.kind === 'city' ? initial.pick.cityId : (selectedCityId ?? CITIES[0].id))
  const [scene, setScene] = useState<Scene>({ weather: initial.settings.weather, sky: initial.settings.sky, mix: initial.settings.mix })
  const [timerOn, setTimerOn] = useState(initial.settings.timer !== null)
  const [timer, setTimer] = useState(initial.settings.timer ?? DEFAULT_TIMER)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [before] = useState(snapshot)
  const finished = useRef(false)

  // Preview: the scene follows the editor
  useEffect(() => {
    applySettings({ ...scene, ambientLinked: false })
  }, [scene])

  // Leaving without saving puts things back
  useEffect(
    () => () => {
      if (finished.current) return
      applySettings({ ...before.scene, ambientLinked: before.ambientLinked })
      useRadioStore.getState().setAtmosphere(before.atmosphere)
    },
    [before],
  )

  const tags = cleanTags(tagText.split(','))
  const pick: StationPick | null =
    kind === 'keep' ? { kind: 'keep' } : kind === 'city' ? { kind: 'city', cityId } : tags.length ? { kind: 'tag', tags } : null
  const problem = !name.trim() ? 'Give your mood a name to save it.' : !pick ? 'Type a genre, or choose another music source.' : null

  const setWeather = (patch: Partial<Scene['weather']>) => setScene((s) => ({ ...s, weather: { ...s.weather, ...patch } }))
  const setMix = (patch: Partial<SoundMix>) => setScene((s) => ({ ...s, mix: { ...s.mix, ...patch } }))
  const toggleGenre = (genre: string) =>
    setTagText((text) => {
      const current = cleanTags(text.split(','))
      return (current.includes(genre) ? current.filter((t) => t !== genre) : [...current, genre]).join(', ')
    })

  const save = (play: boolean) => {
    if (problem || !pick) return
    const mood = makeMood(initial.id, {
      name: name.trim().slice(0, 40),
      tagline: tagline.trim().slice(0, 80),
      pick,
      settings: { ...scene, ambientLinked: false, timer: timerOn ? timer : null },
    })
    finished.current = true
    saveMood(mood)
    if (play) void playAtmosphere(customToAtmosphere(mood))
    // The scene is already on, so the mood is too
    else setAtmosphere({ id: mood.id, name: mood.name })
    showToast(`Saved “${mood.name}”`)
    onDone()
  }

  const remove = () => {
    if (!initial.id) return
    finished.current = true
    applySettings({ ...before.scene, ambientLinked: before.ambientLinked })
    setAtmosphere(before.atmosphere?.id === initial.id ? null : before.atmosphere)
    removeMood(initial.id)
    showToast(`Deleted “${initial.name}”`)
    onDone()
  }

  return (
    <form
      aria-labelledby="mood-editor-heading"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        save(true)
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 id="mood-editor-heading" className="engraved font-term text-[13px] uppercase">
          {initial.id ? 'Edit mood' : 'New mood'}
        </h3>
        <p className="font-read text-[12px] leading-snug text-zinc-400">
          Changes play as you make them, so you can hear and see the mood before saving. Cancel puts back what was on.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className={heading}>Name</span>
        <input className={input} value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Late-night drive" />
      </label>
      <label className="flex flex-col gap-1">
        <span className={heading}>Description (optional)</span>
        <input
          className={field}
          value={tagline}
          maxLength={80}
          onChange={(e) => setTagline(e.target.value)}
          placeholder="One line to remember it by"
        />
      </label>

      <Group title="Music" note="Where the music comes from when you play this mood. The display always shows the station's real location.">
        {MUSIC.map((m) => (
          <label key={m.kind} className="flex cursor-pointer items-start gap-2 rounded-[3px] px-1 py-0.5 hover:bg-white/5">
            <input type="radio" name="mood-music" checked={kind === m.kind} onChange={() => setKind(m.kind)} className="mt-1 accent-amber-400" />
            <span className="min-w-0">
              <span className="block font-read text-[13px] text-zinc-200">{m.label}</span>
              <span className={`block ${hint}`}>{m.hint}</span>
            </span>
          </label>
        ))}
        {kind === 'tag' && (
          <div className="flex flex-col gap-1.5 pl-6">
            <input
              className={field}
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="jazz, soul"
              aria-label="Genres, separated by commas"
            />
            <div className="flex flex-wrap gap-1" aria-label="Suggested genres">
              {GENRES.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={tags.includes(g)}
                  onClick={() => toggleGenre(g)}
                  className="rounded-[2px] border border-black bg-zinc-800 px-1.5 py-0.5 font-read text-[11px] text-zinc-300 hover:text-amber-300 aria-pressed:bg-amber-400/90 aria-pressed:text-black"
                >
                  {g}
                </button>
              ))}
            </div>
            <p className={hint}>Up to four, tried in order until one finds a station.</p>
          </div>
        )}
        {kind === 'city' && (
          <div className="flex pl-6">
            <select className={`${field} flex-1 py-1.5`} value={cityId} onChange={(e) => setCityId(e.target.value)} aria-label="City">
              {CITIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}, {c.country}
                </option>
              ))}
            </select>
          </div>
        )}
      </Group>

      <Group title="Weather & sky" note="Themed for the mood. The display labels it, so nobody takes it for the real weather.">
        <Segmented label="Weather" value={scene.weather.mode} options={WEATHER_OPTIONS} onChange={(mode) => setWeather({ mode })} columns={3} />
        <div className="flex items-end justify-around">
          <Knob label="Density" value={scene.weather.density} defaultValue={0.5} onChange={(density) => setWeather({ density })} size={40} />
          <Knob label="Wind" value={scene.weather.wind} defaultValue={0.5} onChange={(wind) => setWeather({ wind })} format={formatWind} size={40} accent="#7df9ff" />
        </div>
        <Segmented label="Sky" value={scene.sky} options={SKY_OPTIONS} onChange={(sky) => setScene((s) => ({ ...s, sky }))} />
      </Group>

      <Group title="Background sounds" note="Mixed under the music. Drag a fader, or focus it and use the arrow keys.">
        <div className="flex justify-between gap-1">
          {ATMOS_FADERS.map(({ key, label }) => (
            <Fader key={key} label={label} value={scene.mix[key]} onChange={(v) => setMix({ [key]: v })} />
          ))}
        </div>
      </Group>

      <Group title="Radio texture" note="How the radio itself sounds: crackle, tape hiss and a muffling filter.">
        <div className="flex items-end justify-around">
          <Knob label="Static" value={scene.mix.staticBlend} defaultValue={0.06} onChange={(staticBlend) => setMix({ staticBlend })} size={40} />
          <Knob label="Hiss" value={scene.mix.hiss} defaultValue={0.15} onChange={(hiss) => setMix({ hiss })} size={40} />
          <Knob label="Lo-Pass" value={scene.mix.cutoff} defaultValue={1} onChange={(cutoff) => setMix({ cutoff })} format={formatHz} size={40} accent="#7df9ff" />
        </div>
      </Group>

      <Group title="Focus timer" note="Starts when you play the mood, if no timer is running already.">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleSwitch label={timerOn ? 'On' : 'Off'} checked={timerOn} onChange={setTimerOn} />
          <label className="flex items-center gap-1 font-read text-[12px] text-zinc-400">
            <input
              type="number"
              min={1}
              max={180}
              disabled={!timerOn}
              className={`${field} w-14`}
              value={timer.work}
              onChange={(e) => setTimer((t) => ({ ...t, work: clampInt(e.target.value, 1, 180, t.work) }))}
            />
            min focus
          </label>
          <label className="flex items-center gap-1 font-read text-[12px] text-zinc-400">
            <input
              type="number"
              min={1}
              max={60}
              disabled={!timerOn}
              className={`${field} w-12`}
              value={timer.short}
              onChange={(e) => setTimer((t) => ({ ...t, short: clampInt(e.target.value, 1, 60, t.short) }))}
            />
            min break
          </label>
        </div>
      </Group>

      <div className="sticky bottom-0 -mx-2 flex flex-col gap-1.5 border-t border-black bg-zinc-900/95 px-2 py-2">
        {problem && <p className="font-read text-[12px] text-amber-300/90">{problem}</p>}
        <div className="flex flex-wrap gap-1.5">
          <button type="submit" className={button} disabled={!!problem}>
            <Play size={13} fill="currentColor" /> Save &amp; play
          </button>
          <button type="button" className={button} disabled={!!problem} onClick={() => save(false)} title="Save and keep the music that's on">
            <Save size={13} /> Save
          </button>
          <button type="button" className={button} onClick={onDone}>
            <X size={13} /> Cancel
          </button>
          {initial.id &&
            (confirmDelete ? (
              <span className="flex items-center gap-1 font-read text-[12px] text-zinc-300">
                Delete?
                <button type="button" className={button} onClick={remove} aria-label={`Delete ${initial.name} for good`}>
                  <Check size={13} />
                </button>
                <button type="button" className={button} onClick={() => setConfirmDelete(false)} aria-label="Keep it">
                  <X size={13} />
                </button>
              </span>
            ) : (
              <button type="button" className={`${button} ml-auto`} onClick={() => setConfirmDelete(true)} aria-label={`Delete ${initial.name}`}>
                <Trash2 size={13} />
              </button>
            ))}
        </div>
      </div>
    </form>
  )
}
