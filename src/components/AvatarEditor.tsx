import { ChevronLeft, ChevronRight, Shuffle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AVATAR_H, AVATAR_SLOTS, AVATAR_W, composeAvatar, cycle, PARTS, randomAvatar, SLOT_LABEL, type Avatar } from '../avatar/parts'
import { totals } from '../progress/progress'
import { earnedParts } from '../progress/unlocks'
import { isCalm, useRadioStore } from '../store/useRadioStore'
import { EarnList } from './PassportPanel'

const SCALE = 10

/** Big pixel preview of the avatar, stepping in place unless Calm is on. */
function AvatarPreview({ avatar }: { avatar: Avatar }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const calm = useRadioStore(isCalm)
  const [stride, setStride] = useState(false)

  useEffect(() => {
    if (calm) return
    const id = window.setInterval(() => setStride((v) => !v), 320)
    return () => window.clearInterval(id)
  }, [calm])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const step = stride && !calm
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    composeAvatar(avatar, step).forEach((row, y) =>
      row.forEach((color, x) => {
        if (!color) return
        ctx.fillStyle = color
        ctx.fillRect((x + 1) * SCALE, (y + 1 - (step ? 1 : 0) + 1) * SCALE, SCALE, SCALE)
      }),
    )
  }, [avatar, stride, calm])

  return (
    <canvas
      ref={canvas}
      width={(AVATAR_W + 2) * SCALE}
      height={(AVATAR_H + 3) * SCALE}
      role="img"
      aria-label="Your avatar"
      className="pixelated mx-auto"
    />
  )
}

/** Avatar tab of the drawer: swap each part, or shuffle the lot. */
export function AvatarEditor() {
  const avatar = useRadioStore((s) => s.avatar)
  const setAvatar = useRadioStore((s) => s.setAvatar)
  const progress = useRadioStore((s) => s.progress)
  const allowed = earnedParts(totals(progress))
  const arrow =
    'grid size-8 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 text-zinc-200 shadow-[0_2px_0_#000] hover:text-amber-300 active:translate-y-0.5 active:shadow-none'

  return (
    <div className="flex flex-col gap-3">
      <div className="lcd rounded-[3px] py-2">
        <AvatarPreview avatar={avatar} />
      </div>
      <ul className="flex flex-col gap-1.5">
        {AVATAR_SLOTS.map((slot) => (
          <li key={slot} className="flex items-center gap-2">
            <span className="engraved w-14 shrink-0 font-term text-[13px] uppercase">{SLOT_LABEL[slot]}</span>
            <button type="button" className={arrow} aria-label={`Previous ${SLOT_LABEL[slot].toLowerCase()}`} onClick={() => setAvatar(cycle(avatar, slot, -1, allowed))}>
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-0 flex-1 truncate text-center font-term text-[17px] text-lcd" aria-live="polite">
              {PARTS[slot][avatar[slot]].name}
            </span>
            <button type="button" className={arrow} aria-label={`Next ${SLOT_LABEL[slot].toLowerCase()}`} onClick={() => setAvatar(cycle(avatar, slot, 1, allowed))}>
              <ChevronRight size={16} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setAvatar(randomAvatar(Math.random, allowed))}
        className="flex items-center justify-center gap-2 self-center rounded-[3px] border border-black bg-gradient-to-b from-amber-300 to-amber-500 px-4 py-1.5 font-term text-[16px] tracking-wider text-black uppercase shadow-[0_2px_0_#000] active:translate-y-0.5 active:shadow-none"
      >
        <Shuffle size={15} /> Shuffle
      </button>
      <p className="font-read text-[12px] leading-snug text-zinc-500">
        Your avatar travels to whatever station you tune to: on foot, rowing over water, or by plane or hot-air balloon for long trips. Friends see it travel too, and you see theirs.
      </p>
      <EarnList />
    </div>
  )
}
