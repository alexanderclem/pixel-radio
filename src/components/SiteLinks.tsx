const LINKS = [
  ['About', '/about/'],
  ['Privacy', '/privacy/'],
  ['Terms', '/terms/'],
  ['Contact', '/contact/'],
] as const

/** About · Privacy · Terms · Contact, opened in a new tab so the radio keeps playing. */
export function SiteLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="About Pixel Radio" className={`font-read text-[12px] text-lcd-dim ${className}`}>
      {LINKS.map(([label, href], i) => (
        <span key={href}>
          {i > 0 && ' · '}
          <a href={href} target="_blank" rel="noopener" className="underline decoration-dotted underline-offset-2 hover:text-lcd focus-visible:ring-2 focus-visible:ring-amber-400">
            {label}
          </a>
        </span>
      ))}
    </nav>
  )
}
