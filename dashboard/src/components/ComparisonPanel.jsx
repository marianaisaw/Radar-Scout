import { useEffect, useMemo, useState } from 'react'
import { donorRangeFromCohorts } from '../lib/utils'

/** Compact comparison banner — expandable cohort details, scoped to the active disease. */
export default function ComparisonPanel({ info }) {
  const [open, setOpen] = useState(false)
  const cohorts = info?.cohorts || []
  const disease = info?.disease || 'this disease'

  // Reset expanded state when the user switches disease tabs.
  useEffect(() => {
    setOpen(false)
  }, [info?.key])

  const comps = useMemo(
    () => cohorts.map((c) => c.comparison).filter(Boolean),
    [cohorts],
  )

  if (!comps.length) return null

  const cellTypes = [...new Set(cohorts.map((c) => c.cell_type).filter(Boolean))]
  const ctSummary =
    cellTypes.length === 0
      ? 'pathogenic cell type'
      : cellTypes.length === 1
        ? cellTypes[0]
        : `${cellTypes.length} pathogenic cell types`

  const anyBystander = comps.some((c) => c.ref_pop === 'B')
  const anyControl = comps.some((c) => c.ref_kind === 'control')
  const pRange = donorRangeFromCohorts(cohorts, 'p_donors')
  const rRange = donorRangeFromCohorts(cohorts, 'ref_donors')
  const n = (x) => (x || 0).toLocaleString()

  const refSummary = anyControl
    ? 'disease-specific control (e.g. normal scar for keloid MFB)'
    : anyBystander
      ? `healthy ${cellTypes[0] || 'cells'}, or bystander types where no healthy arm exists`
      : `healthy ${cellTypes[0] || 'same cell type'}`

  return (
    <div className="comparison-compact dash-card" key={info?.key}>
      <div className="comparison-compact-main">
        <span className="comparison-label">What we compare · {disease}</span>
        <div className="comparison-line">
          <span className="comparison-pathogenic">
            <span className="comparison-tag">P</span>
            <span style={{ textTransform: 'capitalize' }}>{disease}</span>
            <span className="muted" style={{ fontWeight: 400 }}>
              {' '}
              · {ctSummary}
            </span>
          </span>
          <span className="comparison-vs">vs</span>
          <span className="comparison-reference">
            <span className="comparison-tag ref">Ref</span>
            {refSummary}
          </span>
        </div>
        <div className="comparison-stats muted">
          {pRange ? `${pRange.label} pathogenic donors` : '—'}
          {rRange ? ` · ${rRange.label} reference` : ''}
          {' · '}{cohorts.length} cohort{cohorts.length !== 1 ? 's' : ''}
        </div>
      </div>
      <button type="button" className="link-btn comparison-details-btn" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide cohort details' : `View ${disease} cohort details`}
      </button>
      {open ? (
        <div className="comparison-expanded">
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 10px', lineHeight: 1.55 }}>
            Each row is an independent study. Pathogenic cells from <strong>{disease}</strong> tissue
            are compared to that cohort&apos;s reference arm.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Cohort</th>
                  <th>Pathogenic — {disease}</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) =>
                  c.comparison ? (
                    <tr key={c.key}>
                      <td>
                        <strong>{c.cohort}</strong>
                        {c.cell_type ? (
                          <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                            {c.cell_type}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className="comparison-row-label pathogenic">
                          {c.comparison.p_label || `${disease} (pathogenic)`}
                        </span>
                        <span className="comparison-row-counts muted">
                          {' '}
                          · {n(c.comparison.p_donors)} donors · {n(c.comparison.p_cells)} cells
                        </span>
                      </td>
                      <td>
                        <span className="comparison-row-label reference">
                          {c.comparison.ref_label
                            || (c.comparison.ref_kind === 'healthy'
                              ? 'Healthy / control'
                              : c.comparison.ref_kind === 'control'
                                ? 'Disease-specific control'
                                : 'Bystander cell types')}
                        </span>
                        <span className="comparison-row-counts muted">
                          {' '}
                          · {n(c.comparison.ref_donors)} donors · {n(c.comparison.ref_cells)} cells
                        </span>
                      </td>
                    </tr>
                  ) : null,
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
