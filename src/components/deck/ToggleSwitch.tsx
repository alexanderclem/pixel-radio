interface ToggleSwitchProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  color?: string
  disabled?: boolean
}

/** Latching push-button with an indicator LED. */
export function ToggleSwitch({ label, checked, onChange, color = '#7dffa8', disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex items-center gap-2 rounded-[3px] border border-black bg-gradient-to-b from-zinc-700 to-zinc-800 px-2 py-1 text-left shadow-[0_2px_0_#000,inset_0_1px_0_rgb(255_255_255/0.1)] transition active:translate-y-0.5 active:shadow-[0_0_0_#000] disabled:opacity-40 aria-pressed:from-zinc-800 aria-pressed:to-zinc-900"
    >
      <span
        className="size-2 shrink-0 rounded-full transition"
        style={{ background: checked ? color : '#2a2a2f', boxShadow: checked ? `0 0 6px ${color}` : 'inset 0 1px 1px #000' }}
      />
      <span className="font-term text-[14px] leading-none tracking-wider text-zinc-300 uppercase">{label}</span>
    </button>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  /** Lay the buttons out on a fixed grid instead of a single row */
  columns?: number
}

/** Rotary-selector style row of mutually exclusive buttons. */
export function Segmented<T extends string>({ label, value, options, onChange, columns }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1">
      <span className="engraved font-term text-[12px] leading-none uppercase">{label}</span>
      <div
        className={`${columns ? 'grid gap-px' : 'flex'} overflow-hidden rounded-[3px] border border-black bg-black`}
        style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      >
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={`flex-1 ${columns ? '' : 'border-r border-black last:border-r-0'} px-1.5 py-1 font-term text-[13px] leading-none tracking-wide uppercase transition ${
                active
                  ? 'bg-amber-400/90 text-black shadow-[inset_0_0_8px_rgb(255_200_80/0.8)]'
                  : 'bg-gradient-to-b from-zinc-700 to-zinc-800 text-zinc-300 hover:text-amber-200'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
