import { useEffect, useMemo, useState } from 'react'

/** Comparison banner — P vs reference, with expandable per-cohort details. */
export default function ComparisonPanel({ info }) {
  const [open, setOpen] = useState(false)
  const cohorts = info?.cohorts || []
  const disease = info?.disease || 'this disease'

  useEffect(() => {
    setOpen(false)
  }, [info?.key])

  const comps = useMemo(
    () => cohorts.map((c) => c.comparison).filter(Boolean),
    [cohorts],
  )

  if (!comps.length) return null

  const n = (x) => (x || 0).toLocaleString()
  const sum = (field) => comps.reduce((acc, c) => acc + (Number(c[field]) || 0), 0)
  const first = comps[0]
  const pLabel = first.p_label || `${disease} (pathogenic)`
  const refLabel =
    first.ref_label
    || (first.ref_kind === 'healthy'
      ? 'Healthy / control'
      : first.ref_kind === 'control'
        ? 'Disease-specific control'
        : 'Bystander cell types')

  return (
    <div className="comparison-compact dash-card ranking-compare-card" key={info?.key}>
      <div className="ranking-compare-head">
        <span className="comparison-label">What is being compared</span>
        <span className="muted" style={{ fontSize: 12 }}>
          Every score below contrasts these two groups
        </span>
      </div>
      <div className="ranking-compare-grid">
        <div className="ranking-compare-arm pathogenic">
          <span className="comparison-tag">Pathogenic (P)</span>
          <strong>{pLabel}</strong>
          <span className="muted">
            {first.unit === "libraries"
              ? `${n(sum("p_donors"))} libraries`
              : `${n(sum("p_donors"))} donors · ${n(sum("p_cells"))} cells`}
          </span>
        </div>
        <span className="comparison-vs">vs</span>
        <div className="ranking-compare-arm reference">
          <span className="comparison-tag ref">Reference (H)</span>
          <strong>{refLabel}</strong>
          <span className="muted">
            {first.unit === "libraries"
              ? `${n(sum("ref_donors"))} libraries`
              : `${n(sum("ref_donors"))} donors · ${n(sum("ref_cells"))} cells`}
          </span>
        </div>
      </div>
      <button type="button" className="link-btn comparison-details-btn" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide per-cohort breakdown' : `Per-cohort breakdown (${cohorts.length})`}
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
