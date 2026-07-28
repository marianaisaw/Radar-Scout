import { useState } from 'react'
import { RANK_METRICS, COLORS } from '../lib/utils'

// Shows exactly what the active ranking computes: the equation, what the number
// on screen means, and a plain-language reading of every term. Collapsed to the
// equation by default; "What do these terms mean?" expands the glossary.
export default function FormulaPanel({ rankMetric }) {
  const [open, setOpen] = useState(false)
  const m = RANK_METRICS[rankMetric]
  if (!m) return null

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-body" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <strong style={{ color: m.color, fontSize: 14 }}>{m.long}</strong>
          <span className="muted" style={{ fontSize: 12.5 }}>{m.summary}</span>
        </div>

        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            background: '#fafafa',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 4,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12.5,
            color: COLORS.ink,
            overflowX: 'auto',
            whiteSpace: 'nowrap',
          }}
        >
          {m.formula}
        </div>

        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          <strong style={{ color: COLORS.ink }}>Reading the number:</strong> {m.scale}
        </div>

        <button
          className="link-btn"
          style={{ marginTop: 8, fontSize: 12 }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '− Hide term definitions' : '+ What do these terms mean?'}
        </button>

        {open ? (
          <dl style={{ margin: '10px 0 0', display: 'grid', gap: 8 }}>
            {m.terms.map(([term, def]) => (
              <div key={term} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
                <dt
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 12,
                    color: m.color,
                    fontWeight: 600,
                  }}
                >
                  {term}
                </dt>
                <dd className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                  {def}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  )
}
