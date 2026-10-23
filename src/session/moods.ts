import { CITY_BY_ID } from '../constants/cities'
import { useRadioStore } from '../store/useRadioStore'
import { ATMOSPHERE_BY_ID, type Atmosphere } from './atmospheres'
import { captureSettings, type CustomMood, type MoodSettings, type StationPick } from './setup'

/** Listener-made moods next to the built-in atmospheres: lookup, and drafts for the editor. */

/** Where a pick's music comes from, in plain words ("A jazz station", "A station near Paris"). */
export function pickSource(pick: StationPick): string {
  if (pick.kind === 'keep') return "Whatever's playing"
  if (pick.kind === 'city') return `A station near ${CITY_BY_ID[pick.cityId]?.name ?? 'the city'}`
  return `A ${pick.tags[0]} station`
}

export function customToAtmosphere(m: CustomMood): Atmosphere {
  return {
    id: m.id,
    name: m.name,
    tagline: m.tagline,
    source: pickSource(m.pick),
    pick: m.pick,
    fallbackId: 'rp-mellow',
    settings: { ...m.settings, view: null },
    custom: true,
  }
}

/** A built-in atmosphere or one of the listener's moods, by id. */
export function findMood(id: string): Atmosphere | null {
  const builtIn = ATMOSPHERE_BY_ID[id]
  if (builtIn) return builtIn
  const mine = useRadioStore.getState().library.moods.find((m) => m.id === id)
  return mine ? customToAtmosphere(mine) : null
}

export const newMoodId = () => `my-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** A mood ready to keep: a new id unless it replaces one, stamped now. */
export function makeMood(id: string | null, fields: Omit<CustomMood, 'id' | 'savedAt'>): CustomMood {
  return { id: id ?? newMoodId(), ...fields, savedAt: Date.now() }
}

/** What the editor works on: everything a mood has, with the id kept when editing. */
export interface MoodDraft {
  id: string | null
  name: string
  tagline: string
  pick: StationPick
  settings: MoodSettings
}

const sceneOf = (settings: Omit<MoodSettings, 'ambientLinked'> & { ambientLinked?: boolean }): MoodSettings => ({
  weather: { ...settings.weather },
  sky: settings.sky,
  mix: { ...settings.mix },
  // A mood holds its own mix; Geo Link would pull it toward the map
  ambientLinked: false,
  timer: settings.timer ? { ...settings.timer } : null,
})

/** A new mood from what's on now: the current scene, and the current mood's music source if there is one. */
export function draftFromCurrent(): MoodDraft {
  const s = useRadioStore.getState()
  const settings = captureSettings(s)
  const on = s.atmosphere ? findMood(s.atmosphere.id) : null
  return { id: null, name: '', tagline: '', pick: on?.pick ?? { kind: 'keep' }, settings: sceneOf({ ...settings, timer: settings.timer ?? on?.settings.timer ?? null }) }
}

/** An editable copy of a built-in, or a listener's mood to change in place. */
export function draftFrom(atm: Atmosphere): MoodDraft {
  return {
    id: atm.custom ? atm.id : null,
    name: atm.custom ? atm.name : `My ${atm.name}`.slice(0, 40),
    tagline: atm.tagline,
    pick: atm.pick,
    settings: sceneOf(atm.settings),
  }
}
