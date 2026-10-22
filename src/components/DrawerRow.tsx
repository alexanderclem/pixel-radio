import type { ReactNode } from 'react'

/** One line in a drawer list: optional status dot, two lines of text, small action buttons. */
export function DrawerRow({ title, subtitle, active, leading, actions }: {
  title: string
  subtitle: ReactNode
  active?: boolean
  leading?: ReactNode
  actions: ReactNode
}) {
  return (
    <li className={`flex items-center gap-2 rounded-[3px] px-2 py-1.5 ${active ? 'bg-lcd/10' : 'hover:bg-white/5'}`}>
      {leading}
      <div className="min-w-0 flex-1 font-term leading-tight">
        <div className={`truncate text-[17px] ${active ? 'text-lcd' : 'text-zinc-200'}`}>{title}</div>
        <div className="truncate text-[14px] text-zinc-500">{subtitle}</div>
      </div>
      <div className="flex shrink-0 gap-1">{actions}</div>
    </li>
  )
}

export function RowButton({ label, onClick, disabled, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-7 place-items-center rounded-[3px] border border-black bg-gradient-to-b from-zinc-600 to-zinc-800 text-zinc-200 shadow-[0_1px_0_#000] hover:text-amber-300 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
