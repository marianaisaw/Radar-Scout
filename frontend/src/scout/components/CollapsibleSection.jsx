import { useState } from 'react'

/** Progressive-disclosure section with a quiet, editorial header. */
export default function CollapsibleSection({
  title,
  hint,
  defaultOpen = false,
  children,
  level = 'secondary',
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={`collapse-section collapse-${level}${open ? ' open' : ''}`}>
      <button
        type="button"
        className="collapse-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapse-caret">{open ? '−' : '+'}</span>
        <span className="collapse-title">{title}</span>
        {hint ? <span className="collapse-hint">{hint}</span> : null}
      </button>
      {open ? <div className="collapse-body">{children}</div> : null}
    </section>
  )
}
