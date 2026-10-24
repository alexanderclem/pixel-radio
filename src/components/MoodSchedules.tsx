import { AlarmClock, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ATMOSPHERES } from '../session/atmospheres'
import { customToAtmosphere, findMood } from '../session/moods'
import { DAY_LABELS, daysLabel } from '../sleep/schedules'
import { MAX_SCHEDULES, useRadioStore } from '../store/useRadioStore'
import { ToggleSwitch } from './deck/ToggleSwitch'
import { button, DrawerRow, input, RowButton } from './DrawerRow'

const heading = 'engraved font-term text-[13px] uppercase'
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]

/** Moods that start by themselves at a time of day, while Pixel Radio is open. */
export function MoodSchedules() {
  const schedules = useRadioStore((s) => s.schedules)
  const mine = useRadioStore((s) => s.library.moods)
  const saveSchedule = useRadioStore((s) => s.saveSchedule)
  const removeSchedule = useRadioStore((s) => s.removeSchedule)
  const showToast = useRadioStore((s) => s.showToast)
  const moods = [...mine.map(customToAtmosphere), ...ATMOSPHERES]
  const [adding, setAdding] = useState(false)
  const [moodId, setMoodId] = useState(ATMOSPHERES[1]?.id ?? ATMOSPHERES[0].id)
  const [time, setTime] = useState('07:30')
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])

  const add = async () => {
    saveSchedule({ id: `sch-${Date.now().toString(36)}`, moodId, time, days, enabled: true, lastFired: null })
    setAdding(false)
    // Asked from this click: a notification is how a schedule reaches a background tab
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission()
      } catch {
        // Not allowed here; the first screen still shows the mood when it's due
      }
    }
    showToast(`${findMood(moodId)?.name ?? 'Mood'} at ${time}, ${daysLabel(days).toLowerCase()}`)
  }

  return (
    <section aria-labelledby="schedules-heading" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 id="schedules-heading" className={heading}>Scheduled</h3>
        {!adding && schedules.length < MAX_SCHEDULES && (
          <button type="button" className={button} onClick={() => setAdding(true)}>
            <AlarmClock size={14} /> Schedule
          </button>
        )}
      </div>
      {adding && (
        <div className="flex flex-col gap-2 rounded-[3px] border border-black/60 bg-black/25 p-2">
          <div className="flex gap-1.5">
            <select aria-label="Mood" className={input} value={moodId} onChange={(e) => setMoodId(e.target.value)}>
              {moods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input aria-label="Time" type="time" required className={`${input} max-w-[7rem] flex-none`} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div role="group" aria-label="Days" className="flex flex-wrap gap-1">
            {MONDAY_FIRST.map((d) => (
              <ToggleSwitch
                key={d}
                label={DAY_LABELS[d]}
                checked={days.includes(d)}
                onChange={(on) => setDays(on ? [...days, d] : days.filter((x) => x !== d))}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            <button type="button" className={button} disabled={!/^\d\d:\d\d$/.test(time)} onClick={() => void add()}>
              <Plus size={14} /> Add
            </button>
            <button type="button" className={button} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {schedules.length === 0 && !adding ? (
        <p className="p-1 font-read text-[13px] leading-snug text-zinc-400">
          Start a mood at a time of day, like Morning Jazz at 7:30 on weekdays. It plays while Pixel Radio is open in a tab or installed as an app.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {schedules.map((s) => {
            const name = findMood(s.moodId)?.name ?? 'Deleted mood'
            return (
              <DrawerRow
                key={s.id}
                title={`${s.time} · ${name}`}
                subtitle={`${daysLabel(s.days)}${s.enabled ? '' : ' · paused'}`}
                actions={
                  <>
                    <ToggleSwitch label={s.enabled ? 'On' : 'Off'} checked={s.enabled} onChange={(enabled) => saveSchedule({ ...s, enabled })} />
                    <RowButton label={`Delete the ${s.time} ${name} schedule`} onClick={() => removeSchedule(s.id)}>
                      <Trash2 size={14} />
                    </RowButton>
                  </>
                }
              />
            )
          })}
        </ul>
      )}
    </section>
  )
}
