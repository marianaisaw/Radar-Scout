import { RANK_METRICS, fmt } from '../lib/utils'

// Candidate sort columns, in display order. Only the four headline rankings —
// the RACS sub-factors (Sep/Feas/Repro/OffMax) are diagnostics, not orderings,
// and belong in the detail panel.
const SORT_CANDIDATES = [
  { key: 'RCS', label: 'Consensus' },
  { key: 'DSS', label: 'DSS' },
  { key: 'spec_score', label: 'Sensor' },
  { key: 'RACS', label: 'RACS' },
]

// Left ranked list. Rows show rank, italic gene name, a slim bar for the active
// rank metric, and its numeric value. The bar/value follow whichever metric is
// active (crimson for pooled/RACS, teal for DSS). Sortable by any present
// column; clicking selects.
export default function GeneList({
  genes,
  maxMetric,
  rankMetric,
  selected,
  onSelect,
  sortKey,
  sortDir,
  onSort,
  compareIds,
  onToggleCompare,
  compareEnabled,
}) {
  const rm = RANK_METRICS[rankMetric]
  const probe = genes[0]
  const sortChips = probe
    ? SORT_CANDIDATES.filter((c) => probe[c.key] !== undefined && probe[c.key] !== null)
    : SORT_CANDIDATES

  // Some rankings are sorted on one field but READ better as another: the consensus
  // percentile saturates at 99-100 for every shortlisted gene, so we display the
  // bootstrap P(top 10), which spreads across 0-1.
  const valKey =
    rm.displayKey && probe && probe[rm.displayKey] !== undefined && probe[rm.displayKey] !== null
      ? rm.displayKey
      : rm.key
  const valLabel = valKey === rm.displayKey ? rm.displayLabel : rm.label
  const valD = valKey === rm.displayKey ? rm.displayD : rm.d
  // Scale bars across the DISPLAYED range, not 0..max — otherwise a field whose
  // values all sit near the maximum renders every bar full-width and identical.
  const vals = genes.map((g) => g[valKey]).filter((v) => Number.isFinite(v))
  const vMin = vals.length ? Math.min(...vals) : 0
  const vMax = vals.length ? Math.max(...vals) : 1
  const span = vMax - vMin || 1

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Ranked targets</h2>
        <span className="hint">
          By {rm.label} · {genes.length} shown · value = {valLabel}
        </span>
      </div>

      <div className="list-toolbar">
        <span className="sort-label">Sort</span>
        {sortChips.map((c) => (
          <button
            key={c.key}
            className={`chip${sortKey === c.key ? ' active' : ''}`}
            onClick={() => onSort(c.key)}
          >
            {c.label}
            {sortKey === c.key ? <span className="dir">{sortDir === 'desc' ? '↓' : '↑'}</span> : null}
          </button>
        ))}
      </div>

      {genes.length === 0 ? (
        <div className="empty-note">No genes match the current filters or search.</div>
      ) : (
        <ul className="gene-list">
          {genes.map((g) => {
            const isSel = selected === g.gene
            const inCompare = compareIds.includes(g.gene)
            const val = g[valKey]
            const width = Number.isFinite(val) ? Math.max(3, ((val - vMin) / span) * 100) : 0
            return (
              <li
                key={g.gene}
                className={`gene-row${isSel ? ' selected' : ''}`}
                onClick={() => onSelect(g.gene)}
              >
                <span className="rank">{g._rank}</span>
                <span className="gene-name">
                  {g.gene}
                  {g.confidence ? (
                    <span
                      title={`Consensus confidence · P(top-10)=${g.p_top10 ?? '—'} · signal agreement=${g.signal_agreement ?? '—'}${g.bio_panels ? ` · ${g.bio_panels}` : ''}`}
                      style={{
                        marginLeft: 6,
                        padding: '1px 5px',
                        borderRadius: 3,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: 0.2,
                        color: '#fff',
                        verticalAlign: 'middle',
                        background:
                          g.confidence === 'High'
                            ? '#1c7170'
                            : g.confidence === 'Medium'
                              ? '#c98a2b'
                              : '#a3a3a3',
                      }}
                    >
                      {g.confidence}
                    </span>
                  ) : null}
                  <span className="gene-meta">
                    {g.n_cohorts_present ?? g.n_cohorts
                      ? `${g.n_cohorts_present ?? g.n_cohorts} cohort${(g.n_cohorts_present ?? g.n_cohorts) > 1 ? 's' : ''}`
                      : g.n_donors
                        ? `${g.n_donors} donors`
                        : ''}
                    {Number.isFinite(g.rank_ci_lo) && Number.isFinite(g.rank_ci_hi) ? (
                      <span
                        title="Bootstrap 95% interval for this gene's rank. Overlapping intervals = statistically tied."
                        style={{ marginLeft: 6 }}
                      >
                        · rank {g.rank_ci_lo}–{g.rank_ci_hi}
                      </span>
                    ) : null}
                    {compareEnabled ? (
                      <>
                        {'  '}
                        <button
                          className="link-btn"
                          style={{ fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation()
                            onToggleCompare(g.gene)
                          }}
                        >
                          {inCompare ? '− compare' : '+ compare'}
                        </button>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="racs-cell">
                  <span className="racs-bar-track">
                    <span
                      className="racs-bar-fill"
                      style={{ width: `${width}%`, background: rm.color }}
                    />
                  </span>
                  <span className="racs-value" title={valLabel}>{fmt(val, valD)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
