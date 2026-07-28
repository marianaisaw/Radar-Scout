import { COLORS } from '../lib/utils'

// States, in plain words, EXACTLY which two groups every metric contrasts.
// Without this the fold-change is ambiguous ("fibroblast vs what?"), so it sits
// directly under the header rather than buried in a tooltip.
export default function ComparisonPanel({ info }) {
  const cohorts = info?.cohorts || []
  const comps = cohorts.map((c) => c.comparison).filter(Boolean)
  if (!comps.length) return null

  const ct = comps[0].cell_type || 'fibroblast'
  const anyBystander = comps.some((c) => c.ref_pop === 'B')
  const totP = comps.reduce((s, c) => s + (c.p_donors || 0), 0)
  const totR = comps.reduce((s, c) => s + (c.ref_donors || 0), 0)
  const cellsP = comps.reduce((s, c) => s + (c.p_cells || 0), 0)
  const cellsR = comps.reduce((s, c) => s + (c.ref_cells || 0), 0)
  const n = (x) => (x || 0).toLocaleString()

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-head">
        <h2>What is being compared</h2>
        <span className="hint">Every score below contrasts these two groups</span>
      </div>
      <div className="panel-body" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={{ flex: '1 1 260px', border: `1px solid ${COLORS.border}`, borderLeft: `3px solid ${COLORS.crimson}`, borderRadius: 4, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, letterSpacing: 0.4, color: COLORS.crimson, fontWeight: 700 }}>
              PATHOGENIC (P)
            </div>
            <div style={{ fontSize: 13.5, marginTop: 3, textTransform: 'capitalize' }}>
              {ct} from <strong>{info.disease}</strong> tissue
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {n(totP)} donors · {n(cellsP)} cells
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', fontSize: 20, color: COLORS.muted }}>vs</div>

          <div style={{ flex: '1 1 260px', border: `1px solid ${COLORS.border}`, borderLeft: `3px solid ${COLORS.teal}`, borderRadius: 4, padding: '10px 12px' }}>
            <div style={{ fontSize: 11, letterSpacing: 0.4, color: COLORS.teal, fontWeight: 700 }}>
              REFERENCE ({anyBystander ? 'H / B' : 'H'})
            </div>
            <div style={{ fontSize: 13.5, marginTop: 3, textTransform: 'capitalize' }}>
              {anyBystander
                ? `${ct} from healthy donors, or other cell types where no healthy arm exists`
                : `${ct} from healthy / control donors`}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {n(totR)} donors · {n(cellsR)} cells
            </div>
          </div>
        </div>

        <p className="muted" style={{ fontSize: 12.5, margin: '12px 0 0', lineHeight: 1.55 }}>
          <strong style={{ color: COLORS.ink }}>So the fold-change is same-cell-type, different-donors:</strong>{' '}
          {ct} taken from {info.disease} patients versus the <em>same</em> {ct} taken from healthy
          donors — not fibroblast-vs-immune-cell, and not disease-vs-other-disease. A positive
          log2FC means the gene is higher in the diseased {ct}. Because the two groups come from
          different people, every quantity is computed per donor and then averaged across donors.
        </p>

        <details style={{ marginTop: 10 }}>
          <summary className="link-btn" style={{ fontSize: 12, cursor: 'pointer' }}>
            Per-cohort breakdown ({comps.length})
          </summary>
          <div style={{ marginTop: 8, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: COLORS.muted }}>
                  <th style={{ padding: '4px 8px 4px 0' }}>Cohort</th>
                  <th style={{ padding: '4px 8px' }}>Pathogenic</th>
                  <th style={{ padding: '4px 8px' }}>Reference</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) =>
                  c.comparison ? (
                    <tr key={c.key} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: '5px 8px 5px 0', whiteSpace: 'nowrap' }}>{c.cohort}</td>
                      <td style={{ padding: '5px 8px' }}>
                        {n(c.comparison.p_donors)} donors · {n(c.comparison.p_cells)} cells
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        {c.comparison.ref_kind === 'healthy' ? 'Healthy' : 'Bystander cell types'} ·{' '}
                        {n(c.comparison.ref_donors)} donors · {n(c.comparison.ref_cells)} cells
                      </td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  )
}
