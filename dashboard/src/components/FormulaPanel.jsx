import { useState } from 'react'
import { RANK_METRICS } from '../lib/utils'

// Shows exactly what the active ranking computes: the equation, what the number
// on screen means, and a plain-language reading of every term. Collapsed to the
// equation by default; "What do these terms mean?" expands the glossary.
export default function FormulaPanel({ rankMetric, compact = false }) {
  const [open, setOpen] = useState(false)
  const m = RANK_METRICS[rankMetric]
  if (!m) return null

  return (
    <div className={compact ? 'formula-compact' : 'panel formula-panel'}>
      <div className={compact ? 'formula-compact-body' : 'panel-body formula-panel-body'}>
        <div className="formula-head">
          <strong className="formula-title" style={{ color: m.color }}>
            {m.long}
          </strong>
          <span className="formula-summary">{m.summary}</span>
        </div>

        <div className="formula-equation">{m.formula}</div>

        <div className="formula-scale">
          <strong>Reading the number:</strong> {m.scale}
        </div>

        <button
          type="button"
          className="link-btn formula-terms-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? '− Hide term definitions' : '+ What do these terms mean?'}
        </button>

        {open ? (
          <dl className="formula-terms">
            {m.terms.map(([term, def]) => (
              <div key={term} className="formula-term">
                <dt className="formula-term-name" style={{ color: m.color }}>
                  {term}
                </dt>
                <dd className="formula-term-def">{def}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  )
}
