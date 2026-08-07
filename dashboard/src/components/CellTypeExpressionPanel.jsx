import { useMemo, useState } from 'react'
import { COLORS, fmt } from '../lib/utils'

// Absolute abundance of the selected trigger in EVERY cell type of the tissue.
// The RACS table only carries a single pooled "bystander" mean, which hides WHICH
// cell type a sensor would misfire in. This resolves it per cell type, in the same
// CP10k units the scorer uses (CPM = CP10k x 100).
// CP10k / CPM are FRACTIONS of a cell's transcriptome, so they are not a safety
// measure on their own: a lymphocyte and a fibroblast at equal CP10k hold very
// different absolute transcript numbers, and a thresholded sensor responds to
// molecules. The last two options are the ones that actually bear on safety.
const UNITS = [
  { k: 'mean_counts', label: 'mRNA molecules / cell', d: 2 },
  { k: 'mean_counts_in_expressing', label: 'Molecules / expressing cell', d: 2 },
  { k: 'pct_ge3', label: '% cells with ≥3 molecules', d: 1 },
  { k: 'mean_cp10k', label: 'CP10k', d: 2 },
  { k: 'mean_cpm', label: 'CPM', d: 0 },
  { k: 'detect_pct', label: '% cells expressing', d: 1 },
  { k: 'est_molecules_per_cell', label: 'Est. molecules / cell', d: 1 },
  { k: 'pct_over_threshold', label: '% cells over sensor threshold', d: 1 },
]

export default function CellTypeExpressionPanel({ data, gene, pathogenicHint }) {
  const [unit, setUnit] = useState('mean_cp10k')
  const [state, setState] = useState('diseased')

  const rows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows
      .filter((r) => r.gene === gene && r.state === state)
      .sort((a, b) => (b[unit] ?? 0) - (a[unit] ?? 0))
  }, [data, gene, state, unit])

  const control = useMemo(() => {
    if (!data?.rows) return new Map()
    return new Map(
      data.rows.filter((r) => r.gene === gene && r.state === 'control').map((r) => [r.cell_type, r]),
    )
  }, [data, gene])

  const isFib = (ct) => /fibro|myofibro|stellate|mesenchym/i.test(ct)

  // Selectivity = best target-compartment cell type vs the highest OFF-target cell
  // type. Below 1x the sensor would fire more strongly somewhere it should not —
  // a risk the pooled bystander mean in the RACS table cannot show.
  const sel = useMemo(() => {
    const dz = (data?.rows || []).filter((r) => r.gene === gene && r.state === 'diseased')
    const fib = dz.filter((r) => isFib(r.cell_type)).sort((a, b) => b.mean_cp10k - a.mean_cp10k)[0]
    const oth = dz.filter((r) => !isFib(r.cell_type)).sort((a, b) => b.mean_cp10k - a.mean_cp10k)[0]
    if (!fib || !oth) return null
    return { fib, oth, ratio: fib.mean_cp10k / Math.max(oth.mean_cp10k, 1e-9) }
  }, [data, gene])

  if (!data?.rows?.length) return null
  const hasGene = data.genes?.includes(gene)
  const max = rows.length ? Math.max(...rows.map((r) => r[unit] ?? 0)) : 1
  const u = UNITS.find((x) => x.k === unit)

  return (
    <div className="panel viz-panel">
      <div className="panel-head">
        <h2>Absolute expression by cell type</h2>
        <span className="hint">
          {hasGene ? `${gene} · ${state} tissue` : `Profiled genes: ${(data.genes || []).join(', ')}`}
        </span>
      </div>
      <div className="panel-body">
        {data.comparability && !data.same_dataset ? (
          <div
            style={{
              border: `1px solid ${COLORS.border}`, borderRadius: 4, background: '#FBF3F2',
              padding: '9px 12px', marginBottom: 12, fontSize: 11.5, lineHeight: 1.5,
            }}
          >
            <strong style={{ color: COLORS.crimson }}>Read with care · </strong>
            <span className="muted">{data.comparability}</span>
          </div>
        ) : null}

        {!hasGene ? (
          <div className="empty-note">
            No per-cell-type profile for <em>{gene}</em>. Profiles are precomputed for the
            genes listed above; rerun <code>celltype_expression_profile</code> to add more.
          </div>
        ) : (
          <>
            {sel ? (
              <div
                style={{
                  border: `1px solid ${COLORS.border}`, borderLeft: 'none', borderRadius: 4,
                  background: sel.ratio >= 1 ? '#F2F7F5' : '#FBF3F2',
                  padding: '10px 12px', marginBottom: 12, fontSize: 12.5, lineHeight: 1.55,
                }}
              >
                <strong style={{ color: sel.ratio >= 1 ? COLORS.teal : COLORS.crimson }}>
                  {sel.ratio >= 1
                    ? `${gene} is ${sel.ratio.toFixed(1)}× enriched in its target compartment`
                    : `Off-target risk — ${gene} is HIGHER outside the target compartment`}
                </strong>
                <span className="muted">
                  {' '}· {fmt(sel.fib.mean_cp10k, 2)} CP10k ({fmt(sel.fib.mean_cpm, 0)} CPM) in{' '}
                  <span style={{ textTransform: 'capitalize' }}>{sel.fib.cell_type}</span> versus{' '}
                  {fmt(sel.oth.mean_cp10k, 2)} CP10k ({fmt(sel.oth.mean_cpm, 0)} CPM) in{' '}
                  <span style={{ textTransform: 'capitalize' }}>{sel.oth.cell_type}</span>, the
                  highest non-target cell type in the same tissue.
                </span>
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div className="seg">
                {UNITS.filter((x) => rows.some((r) => Number.isFinite(r[x.k]))).map((x) => (
                  <button key={x.k} className={`seg-btn${unit === x.k ? ' active' : ''}`} onClick={() => setUnit(x.k)}>
                    {x.label}
                  </button>
                ))}
              </div>
              <div className="seg">
                {['diseased', 'control'].map((sx) => (
                  <button key={sx} className={`seg-btn${state === sx ? ' active' : ''}`} onClick={() => setState(sx)}>
                    {sx === 'diseased' ? 'Diseased tissue' : 'Control tissue'}
                  </button>
                ))}
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: COLORS.muted, fontSize: 11 }}>
                  <th style={{ padding: '4px 8px 6px 0', width: '26%' }}>Cell type</th>
                  <th style={{ padding: '4px 8px 6px 0' }}>{u.label} in this cell type</th>
                  {state === 'diseased' ? (
                    <th style={{ padding: '4px 8px', width: 90, textAlign: 'right' }}>Same cell type, control</th>
                  ) : null}
                  <th style={{ padding: '4px 8px', width: 78, textAlign: 'right' }}>Cells</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const w = max > 0 ? Math.max(1, ((r[unit] ?? 0) / max) * 100) : 0
                  const ctl = control.get(r.cell_type)
                  const target = isFib(r.cell_type)
                  return (
                    <tr key={r.cell_type} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: '5px 8px 5px 0', textTransform: 'capitalize' }}>
                        <span style={{ fontWeight: target ? 700 : 400, color: target ? COLORS.crimson : COLORS.ink }}>
                          {r.cell_type}
                        </span>
                      </td>
                      <td style={{ padding: '5px 8px 5px 0' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ flex: 1, height: 9, background: '#f0f0f0', borderRadius: 2, overflow: 'hidden' }}>
                            <span style={{ display: 'block', width: `${w}%`, height: '100%',
                              background: target ? COLORS.crimson : COLORS.tealSoft }} />
                          </span>
                          <span style={{ width: 74, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {fmt(r[unit], u.d)}
                          </span>
                        </span>
                      </td>
                      {state === 'diseased' ? (
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>
                          {ctl ? fmt(ctl[unit], u.d) : '—'}
                        </td>
                      ) : null}
                      <td style={{ padding: '5px 8px', textAlign: 'right', color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>
                        {r.n_cells?.toLocaleString?.() ?? r.n_cells}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <p className="muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.55 }}>
              Donor-aware means: averaged within each donor first, then across donors, so one
              deeply-sequenced patient cannot dominate. <strong>CP10k</strong> = counts per 10,000
              transcripts; <strong>CPM</strong> = CP10k × 100. Rows in crimson are the intended
              pathogenic compartment{pathogenicHint ? ` (${pathogenicHint})` : ''} — every other row
              is off-target risk, and the control column shows what the same cell type does in
              healthy tissue.
            </p>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.55 }}>
              <strong style={{ color: COLORS.crimson }}>CP10k alone is not a safety measure.</strong>{' '}
              It is a fraction of each cell&rsquo;s transcriptome, so a small lymphocyte and a large
              fibroblast at the same CP10k carry very different absolute transcript numbers — and a
              thresholded sensor responds to molecules, not fractions. Use{' '}
              <em>Est. molecules / cell</em> (CP10k × that cell type&rsquo;s median library size ÷
              10,000) and <em>% cells over sensor threshold</em> (the share of cells that actually
              exceed this gene&rsquo;s operating point k_op) to judge off-target firing. Both remain
              subject to 10x dropout, to the cell-type labels being correct, and to this tissue being
              the only one the therapy reaches.
            </p>
            {data.source ? (
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Source: {data.source}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
