import { useState } from 'react'
import { RANK_METRICS } from '../lib/utils'

const BULK_METRICS = {
  spec_score: {
    ...RANK_METRICS.spec_score,
    formula: 'Sensor(g) = max(log2FC, 0) × max(occ_P − occ_H, 0)',
    summary:
      'Same Sensor equation as CELLxGENE. occ is CPM/(CPM+5) occupancy of a bulk library, replacing the fraction of cells with count > 0.',
    terms: [
      ['log2FC', 'log2((mean_P + 1) / (mean_H + 1)). Same algebra and pseudocount as CELLxGENE; means are library CPM, not per-cell CP10k.'],
      ['occ_P − occ_H', 'occ = CPM / (CPM + 5). Same role as (detection_P − detection_ref) / 100 in the single-cell score.'],
    ],
  },
  DSS: {
    ...RANK_METRICS.DSS,
    formula: 'DSS(g) = max(log2FC, 0) × log10(mean_P + 1)',
    summary:
      'Same DSS equation as CELLxGENE. mean_P is bulk CPM in the pathogenic libraries, not per-cell CP10k.',
    terms: [
      ['log2FC', 'Log2 ratio of mean library CPM, pathogenic vs healthy. Clipped at 0 so down-regulated genes score 0.'],
      ['mean_P', 'Mean CPM in pathogenic libraries, not CP10k in pathogenic cells.'],
    ],
  },
  RCS: {
    ...RANK_METRICS.RCS,
    formula: 'Consensus_bulk(g) = percentile rank of Sensor_bulk within this zip',
    summary:
      'Not the CELLxGENE multi-cohort consensus. With one bulk experiment, this is only the percentile of the bulk Sensor ranking.',
    terms: [
      ['percentile', 'Rank among expressed protein-coding genes in this zip, 100 = best.'],
    ],
  },
}

export default function FormulaPanel({ rankMetric, compact = false, mini = false, bulk = false }) {
  const [open, setOpen] = useState(false)
  const m = (bulk && BULK_METRICS[rankMetric]) || RANK_METRICS[rankMetric]
  if (!m) return null

  if (mini) {
    return (
      <div className="formula-mini">
        <button
          type="button"
          className="link-btn formula-terms-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Hide ranking formula" : "How is this ranked?"}
        </button>
        {open ? (
          <>
            <code style={{ color: m.color }}>{m.formula}</code>
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
          </>
        ) : null}
      </div>
    )
  }

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
