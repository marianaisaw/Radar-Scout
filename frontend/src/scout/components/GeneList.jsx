import { RANK_METRICS, fmt } from '../lib/utils'
import FormulaPanel from './FormulaPanel'

const SORT_CANDIDATES = [
  { key: 'RCS', label: 'Consensus' },
  { key: 'DSS', label: 'DSS' },
  { key: 'spec_score', label: 'Sensor' },
  { key: 'RACS', label: 'RACS' },
]

export default function GeneList({
  genes,
  rankMetric,
  selected,
  onSelect,
  sortKey,
  sortDir,
  onSort,
  compareIds,
  onToggleCompare,
  compareEnabled,
  bulk = false,
}) {
  const rm = RANK_METRICS[rankMetric]
  const probe = genes[0]
  const sortChips = probe
    ? SORT_CANDIDATES.filter((c) => probe[c.key] !== undefined && probe[c.key] !== null)
    : SORT_CANDIDATES

  const valKey =
    rm.displayKey && probe && probe[rm.displayKey] !== undefined && probe[rm.displayKey] !== null
      ? rm.displayKey
      : rm.key
  const valLabel = valKey === rm.displayKey ? rm.displayLabel : rm.label
  const valD = valKey === rm.displayKey ? rm.displayD : rm.d
  const vals = genes.map((g) => g[valKey]).filter((v) => Number.isFinite(v))
  const vMin = vals.length ? Math.min(...vals) : 0
  const vMax = vals.length ? Math.max(...vals) : 1
  const span = vMax - vMin || 1

  return (
    <div className="panel ranks-panel glass-card">
      <div className="card-head">
        <div>
          <h3>All ranked targets</h3>
          <div className="sub">
            {genes.length > 6
              ? `Showing ${genes.length.toLocaleString()} ranked genes`
              : `${genes.length} shown`}
            {rankMetric === "spec_score" ? "" : ` · ${rm.label}`}
          </div>
        </div>
        <div className="toolbar list-toolbar">
          <span className="ranking-rankby">Rank by</span>
          {sortChips.map((c) => (
            <button
              key={c.key}
              className={`chip${sortKey === c.key ? " active" : ""}`}
              onClick={() => onSort(c.key)}
            >
              {c.label}
              {sortKey === c.key ? <span className="dir">{sortDir === "desc" ? "↓" : "↑"}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="ranks-formula">
        <FormulaPanel key={`${rankMetric}-${bulk ? "bulk" : "sc"}`} rankMetric={rankMetric} mini bulk={bulk} />
      </div>

      {genes.length === 0 ? (
        <div className="empty-note">No genes match the current filters or search.</div>
      ) : (
        <div className="gene-rank-scroll-wrap">
          <div className="gene-rank-header" aria-hidden="true">
            <span>#</span>
            <span>Target · {valLabel}</span>
          </div>
          <ul className="gene-rank-list" aria-label="Ranked targets">
          {genes.map((g) => {
            const isSel = selected === g.gene
            const inCompare = compareIds.includes(g.gene)
            const val = g[valKey]
            const width = Number.isFinite(val) ? Math.max(8, ((val - vMin) / span) * 100) : 0
            const rankTier =
              g._rank === 1 ? 'gold' : g._rank === 2 ? 'silver' : g._rank === 3 ? 'bronze' : ''
            return (
              <li
                key={g.gene}
                className={`gene-rank-row${isSel ? ' selected' : ''}${rankTier ? ` rank-${rankTier}` : ''}`}
                onClick={() => onSelect(g.gene)}
              >
                <span className="gene-rank-num" aria-label={`Rank ${g._rank}`}>
                  {g._rank}
                </span>

                <div className="gene-rank-body">
                  <div className="gene-card-top">
                    <div className="gene-card-id">
                      <div className="gene-card-name-row">
                        <span className="gene-card-name">{g.gene}</span>
                      </div>
                    </div>
                    <span className="gene-card-score" title={valLabel}>
                      {fmt(val, valD)}
                    </span>
                  </div>

                  <div className="gene-card-bar" aria-hidden="true">
                    <span
                      className="gene-card-bar-fill"
                      style={{ width: `${width}%`, background: rm.color }}
                    />
                  </div>
                </div>

                {compareEnabled ? (
                  <button
                    type="button"
                    className="gene-card-compare"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleCompare(g.gene)
                    }}
                  >
                    {inCompare ? 'Remove' : 'Compare'}
                  </button>
                ) : null}
              </li>
            )
          })}
          </ul>
        </div>
      )}
    </div>
  )
}
