import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ScatterChart,
  Scatter,
  ZAxis,
  ReferenceArea,
  LabelList,
} from 'recharts'
import ChartCard from './ChartCard'
import CollapsibleSection from './CollapsibleSection'
import CellTypeExpressionPanel from './CellTypeExpressionPanel'
import VolcanoPanel from './VolcanoPanel'
import UmapPanel from './UmapPanel'
import CrossCohortPanel from './CrossCohortPanel'
import FormulaPanel from './FormulaPanel'
import { interpretSensor } from '../lib/sensorInterpret'
import { COLORS, fmt, RANK_METRICS } from '../lib/utils'

const OFF_POPS = [
  { key: 'act_H', detectKey: 'detect_H', label: 'Healthy' },
  { key: 'act_B', detectKey: 'detect_B', label: 'Bystander' },
  { key: 'act_R', detectKey: 'detect_R', label: 'Related disease' },
]

function BreakdownTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rc-tooltip">
      <div className="tt-title">{p.name}</div>
      <div className="tt-row"><span className="tt-k">value</span><span>{fmt(p.value, 3)}</span></div>
    </div>
  )
}

function ActTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rc-tooltip">
      <div className="tt-title">{label}</div>
      {payload.map((s) => (
        <div className="tt-row" key={s.dataKey}>
          <span className="tt-k" style={{ color: s.color }}>{s.name}</span>
          <span>{fmt(s.value, 3)}</span>
        </div>
      ))}
    </div>
  )
}

function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rc-tooltip">
      <div className="tt-title">{p.gene}</div>
      <div className="tt-row"><span className="tt-k">Δ detection</span><span>{fmt(p.dx, 1)} pts</span></div>
      <div className="tt-row"><span className="tt-k">log2FC</span><span>{fmt(p.fc, 2)}</span></div>
      <div className="tt-row"><span className="tt-k">Sensor</span><span>{fmt(p.sensor, 3)}</span></div>
    </div>
  )
}

function BioQuestion({ title, children }) {
  return (
    <div className="bio-question">
      <h4>{title}</h4>
      <div className="bio-question-body">{children}</div>
    </div>
  )
}

function MetricPill({ label, value, tone = 'neutral' }) {
  return (
    <div className={`metric-pill tone-${tone}`}>
      <span className="metric-pill-label">{label}</span>
      <span className="metric-pill-value">{value}</span>
    </div>
  )
}

export default function DetailPanel({
  gene,
  allGenes,
  rank,
  totalGenes,
  cohorts = [],
  nCohorts,
  ctExpr,
  pathogenicHint,
  volcano,
  volcanoGenes,
  hasFDR,
  isFullVolcano,
  onSelectGene,
  umap,
  umapGeneCols,
  umapLabel,
  crossCohort,
  showCrossCohort,
}) {
  if (!gene) {
    return (
      <div className="detail-empty dashboard-panel">
        <p style={{ margin: 0, fontSize: 15 }}>Select a target from the list.</p>
      </div>
    )
  }

  const { strengths, weaknesses } = interpretSensor(gene, { nCohorts, totalGenes })
  const sensorScore = gene.spec_score
  const fold = Number.isFinite(gene.log2FC) ? Math.pow(2, gene.log2FC) : null

  const offPops = OFF_POPS.filter((o) => gene[o.key] !== undefined && gene[o.key] !== null)
  const offValues = offPops.map((o) => gene[o.key]).filter((v) => typeof v === 'number')
  const worstOff = offValues.length ? Math.max(...offValues) : null
  const worstOffPop = offValues.length
    ? offPops[offPops.findIndex((o) => gene[o.key] === worstOff)]?.label
    : '—'

  const windowRows = [
    { label: 'Pathogenic', value: gene.act_P, detect: gene.detect_P, tone: 'pathogenic' },
    { label: 'Healthy', value: gene.act_H, detect: gene.detect_H, tone: 'healthy' },
    { label: `Worst off-target (${worstOffPop})`, value: worstOff, detect: null, tone: 'offtarget' },
  ].filter((r) => r.value != null || r.detect != null)

  const breakdown = [
    { name: 'Sep', value: gene.Sep, kind: 'comp' },
    { name: 'Feas', value: gene.Feas, kind: 'comp' },
    { name: 'Repro', value: gene.Repro, kind: 'comp' },
    { name: '1 − OffMax', value: gene.OffMax != null ? 1 - gene.OffMax : undefined, kind: 'comp' },
    { name: 'RACS', value: gene.RACS, kind: 'racs' },
  ].filter((b) => b.value !== undefined && b.value !== null)

  const perCohort = gene.per_cohort && typeof gene.per_cohort === 'object' ? gene.per_cohort : null
  const cohortLabel = (key) => cohorts.find((c) => c.key === key)?.cohort || key
  const reproRows = perCohort
    ? Object.entries(perCohort)
        .map(([key, pct]) => ({ key, label: cohortLabel(key), pct }))
        .sort((a, b) => b.pct - a.pct)
    : []

  const scatterData = allGenes
    .filter((g) => g.delta_detect !== undefined && g.log2FC !== undefined)
    .map((g) => ({
      gene: g.gene,
      dx: g.delta_detect,
      fc: g.log2FC,
      sensor: g.spec_score ?? 0,
      z: Math.max(30, (g.spec_score ?? 0) * 260 + 30),
      selected: g.gene === gene.gene,
    }))
  const q = (arr, p) => {
    const a = [...arr].sort((x, y) => x - y)
    return a.length ? a[Math.floor((a.length - 1) * p)] : 0
  }
  const dxQ = q(scatterData.map((d) => d.dx), 0.75)
  const fcQ = q(scatterData.map((d) => d.fc), 0.75)
  const dxMax = Math.max(1, ...scatterData.map((d) => d.dx))
  const fcMax = Math.max(1, ...scatterData.map((d) => d.fc))
  const others = scatterData.filter((d) => !d.selected)
  const selPoint = scatterData.filter((d) => d.selected)

  const metricRows = [
    { k: 'spec_score', label: 'Sensor score', v: gene.spec_score, d: 3 },
    { k: 'RCS', label: 'Consensus (percentile)', v: gene.RCS, d: 1 },
    { k: 'RACS', label: 'RACS', v: gene.RACS, d: 3 },
    { k: 'DSS', label: 'DSS', v: gene.DSS, d: 2 },
    { k: 'Sep', label: 'Separability (AUC)', v: gene.Sep, d: 3 },
    { k: 'Feas', label: 'Feasibility', v: gene.Feas, d: 3 },
    { k: 'Repro', label: 'Reproducibility', v: gene.Repro, d: 3 },
    { k: 'OffMax', label: 'OffMax', v: gene.OffMax, d: 3 },
    { k: 'tpm_P', label: 'TPM · pathogenic', v: gene.tpm_P, d: 0 },
    { k: 'tpm_H', label: 'TPM · healthy', v: gene.tpm_H, d: 0 },
    { k: 'tpm_B', label: 'TPM · bystander', v: gene.tpm_B, d: 0 },
    { k: 'log2FC', label: 'Log2 fold-change', v: gene.log2FC, d: 2 },
    { k: 'detect_P', label: 'Detection · pathogenic (%)', v: gene.detect_P, d: 1 },
    { k: 'detect_H', label: 'Detection · healthy (%)', v: gene.detect_H, d: 1 },
    { k: 'delta_detect', label: 'Δ detection (P − ref, %)', v: gene.delta_detect, d: 1 },
    { k: 'mean_P', label: 'Mean expr · pathogenic', v: gene.mean_P, d: 2 },
    { k: 'celltype_spec', label: 'Cell-type specificity', v: gene.celltype_spec, d: 2 },
    { k: 'disease_spec', label: 'Disease specificity', v: gene.disease_spec, d: 2 },
    { k: 'p_value', label: 'p-value', v: gene.p_value, d: 4 },
    { k: 'FDR', label: 'FDR', v: gene.FDR, d: 4 },
    { k: 'p_top10', label: 'P(top 10)', v: gene.p_top10, d: 2 },
    { k: 'signal_agreement', label: 'Metric agreement', v: gene.signal_agreement, d: 2 },
    { k: 'k_op', label: 'Operating threshold k_op', v: gene.k_op, d: 1 },
    { k: 'Youden_J', label: 'Youden J', v: gene.Youden_J, d: 3 },
  ].filter((r) => r.v !== undefined && r.v !== null)

  const nc = gene.n_cohorts_present ?? gene.n_cohorts
  const confClass =
    gene.confidence === 'High'
      ? 'high'
      : gene.confidence === 'Medium'
        ? 'medium'
        : 'low'

  return (
    <div className="detail-sensor-first dashboard-detail">
      {/* ── PRIMARY: Sensor assessment ── */}
      <section className="sensor-hero sensor-hero-compact dash-card">
        <div className="sensor-hero-main">
          <div className="sensor-hero-title">
            <h2 className="sensor-gene-name">{gene.gene}</h2>
            {gene.confidence ? (
              <span className={`confidence-badge ${confClass}`}>{gene.confidence} confidence</span>
            ) : null}
          </div>
          <div className="sensor-hero-score-inline">
            <span className="sensor-score-value">{fmt(sensorScore, 3)}</span>
            <span className="sensor-score-meta">
              Sensor · rank #{rank ?? '—'} / {totalGenes ?? '—'}
            </span>
          </div>
        </div>

        <div className="sensor-header-metrics sensor-header-metrics-compact">
          <MetricPill label="Pathogenic detection" value={`${fmt(gene.detect_P, 1)}%`} tone="pathogenic" />
          <MetricPill label="Healthy detection" value={`${fmt(gene.detect_H ?? gene.detect_B, 1)}%`} tone="healthy" />
          <MetricPill
            label="Δ detection"
            value={Number.isFinite(gene.delta_detect) ? `+${fmt(gene.delta_detect, 1)}%` : '—'}
            tone={gene.delta_detect > 15 ? 'good' : 'neutral'}
          />
          <MetricPill
            label="Disease enrichment"
            value={fold ? `${fmt(fold, 1)}×` : '—'}
            tone={gene.log2FC > 0.5 ? 'good' : 'neutral'}
          />
          <MetricPill
            label="Cohorts"
            value={nc && nCohorts ? `${nc}/${nCohorts}` : nc ? `${nc}` : '—'}
            tone={nc >= (nCohorts || 2) ? 'good' : 'neutral'}
          />
        </div>
      </section>

      <CollapsibleSection title="Summary" defaultOpen={true}>
        {strengths.length ? (
          <ul className="why-list why-strengths why-list-compact">
            {strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : null}
        {weaknesses.length ? (
          <>
            <h4 className="why-subheading">Caveats</h4>
            <ul className="why-list why-weaknesses why-list-compact">
              {weaknesses.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        ) : null}
      </CollapsibleSection>

      {scatterData.length ? (
        <section className="detail-sensor-space dash-card">
          <ChartCard
            title="Sensor optimization space"
            sub="Δ detection vs log2FC · size ∝ Sensor score"
            filename={`${gene.gene}_sensor_space`}
            full
            note="Top quartile on both axes = strongest sensor candidates."
          >
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 16, right: 24, bottom: 32, left: 8 }}>
                <CartesianGrid stroke={COLORS.border} />
                <ReferenceArea x1={dxQ} x2={dxMax} y1={fcQ} y2={fcMax} fill={COLORS.tealFaint} fillOpacity={0.35} stroke={COLORS.tealSoft} strokeDasharray="3 3" />
                <XAxis type="number" dataKey="dx" domain={[0, Math.ceil(dxMax)]} tick={{ fontSize: 11 }} stroke={COLORS.border}
                  label={{ value: 'Δ detection (% pts vs reference →)', position: 'insideBottom', offset: -14, fontSize: 11, fill: COLORS.muted }} />
                <YAxis type="number" dataKey="fc" domain={[0, Math.ceil(fcMax)]} tick={{ fontSize: 11 }} stroke={COLORS.border}
                  label={{ value: 'log2 fold-change (→)', angle: -90, position: 'insideLeft', offset: 16, fontSize: 11, fill: COLORS.muted }} />
                <ZAxis type="number" dataKey="z" range={[30, 340]} />
                <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                <Scatter data={others} fill={COLORS.tealSoft} fillOpacity={0.55} isAnimationActive={false} />
                <Scatter data={selPoint} fill={COLORS.crimson} isAnimationActive={false}>
                  <LabelList dataKey="gene" position="top" style={{ fontSize: 12, fontStyle: 'italic', fill: COLORS.crimson, fontWeight: 600 }} />
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </ChartCard>
        </section>
      ) : null}

      <CollapsibleSection title="Sensor checklist" hint="Activation · specificity · reproducibility" defaultOpen={false}>
      <section className="bio-questions-grid bio-questions-compact">
        <BioQuestion title="Will the sensor activate in target cells?">
          <p>
            {fmt(gene.detect_P, 1)}% of pathogenic cells express this transcript
            {gene.Feas != null ? ` · predicted activation ${fmt(gene.Feas, 2)} at k_op=${fmt(gene.k_op, 1)}` : ''}.
          </p>
        </BioQuestion>
        <BioQuestion title="Will it stay quiet in healthy cells?">
          <p>
            {gene.detect_H != null
              ? `${fmt(gene.detect_H, 1)}% detection in healthy reference`
              : gene.detect_B != null
                ? `${fmt(gene.detect_B, 1)}% detection in reference`
                : 'No healthy reference available'}
            {gene.act_H != null ? ` · activation ${fmt(gene.act_H, 2)}` : ''}.
          </p>
        </BioQuestion>
        <BioQuestion title="Could it fire in unintended cell types?">
          <p>
            Worst off-target: {worstOffPop} (activation {fmt(worstOff, 2)}
            {gene.detect_B != null ? `, ${fmt(gene.detect_B, 1)}% bystander detection` : ''}).
          </p>
        </BioQuestion>
        <BioQuestion title="Is the signal reproducible?">
          <p>
            {nc && nCohorts
              ? `Present in ${nc} of ${nCohorts} cohorts`
              : reproRows.length
                ? `${reproRows.length} cohort records`
                : 'Single-cohort evidence'}
            {gene.Repro != null ? ` · donor reproducibility ${fmt(gene.Repro, 2)}` : ''}.
          </p>
        </BioQuestion>
      </section>
      </CollapsibleSection>

      <CollapsibleSection title="Activation window" hint="Pathogenic vs healthy · off-target" defaultOpen={false}>
        <div className="window-bars">
          {windowRows.map((row) => (
            <div className="window-row" key={row.label}>
              <span className="window-label">{row.label}</span>
              <div className="window-track">
                <span
                  className={`window-fill tone-${row.tone}`}
                  style={{ width: `${Math.min(100, Math.max(0, (row.value ?? 0) * 100))}%` }}
                />
              </div>
              <span className="window-value">{fmt(row.value, 2)}</span>
              {row.detect != null ? (
                <span className="window-detect muted">{fmt(row.detect, 0)}% det</span>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* ── SECONDARY: collapsible sections ── */}
      <CollapsibleSection title="RADAR compatibility" hint="RACS decomposition · off-target check" defaultOpen={false}>
        <div className="charts-grid">
          <ChartCard
            title="RACS breakdown"
            sub="Sep × Feas × Repro × (1 − OffMax)"
            filename={`${gene.gene}_racs_breakdown`}
            note="Multiplicative factors — any single failure reduces RACS."
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={breakdown} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 8 }} barCategoryGap={8}>
                <CartesianGrid horizontal={false} stroke={COLORS.border} />
                <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 11 }} stroke={COLORS.border} />
                <YAxis type="category" dataKey="name" width={78} tick={{ fontSize: 12 }} stroke={COLORS.border} />
                <Tooltip content={<BreakdownTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                <Bar dataKey="value" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                  {breakdown.map((d) => (
                    <Cell key={d.name} fill={d.kind === 'racs' ? COLORS.crimson : COLORS.teal} />
                  ))}
                  <LabelList dataKey="value" position="right" formatter={(v) => fmt(v, 2)} style={{ fontSize: 11, fill: COLORS.muted }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Off-target check"
            sub={`on-target vs worst (${worstOffPop})`}
            filename={`${gene.gene}_off_target`}
          >
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={[{ name: gene.gene, onTarget: gene.act_P, offTarget: worstOff }]}
                margin={{ top: 8, right: 12, bottom: 4, left: -12 }}
              >
                <CartesianGrid vertical={false} stroke={COLORS.border} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fontStyle: 'italic' }} stroke={COLORS.border} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} stroke={COLORS.border} />
                <Tooltip content={<ActTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                <Bar dataKey="onTarget" name="On-target" fill={COLORS.crimson} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={64} />
                <Bar dataKey="offTarget" name="Worst off-target" fill={COLORS.teal} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={64} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <div className="secondary-metrics-strip">
          {gene.RACS != null ? <MetricPill label="RACS" value={fmt(gene.RACS, 3)} /> : null}
          {gene.DSS != null ? <MetricPill label="DSS" value={fmt(gene.DSS, 2)} /> : null}
          {gene.RCS != null ? <MetricPill label="Consensus" value={fmt(gene.RCS, 1)} /> : null}
          {gene.Sep != null ? <MetricPill label="Sep" value={fmt(gene.Sep, 3)} /> : null}
        </div>
      </CollapsibleSection>

      {reproRows.length ? (
        <CollapsibleSection title="Across-cohort evidence" hint={`${reproRows.length} cohorts`} defaultOpen={false}>
          <div className="repro-body">
            {reproRows.map((r) => (
              <div className="repro-row" key={r.key}>
                <span className="repro-label" title={r.label}>{r.label}</span>
                <span className="repro-track">
                  <span className="repro-fill" style={{ width: `${Math.max(1, r.pct)}%` }} />
                </span>
                <span className="repro-val">{fmt(r.pct, 1)}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      {ctExpr ? (
        <CollapsibleSection title="Expression & specificity" hint="Per cell type · absolute abundance" defaultOpen={false}>
          <CellTypeExpressionPanel data={ctExpr} gene={gene.gene} pathogenicHint={pathogenicHint} embedded />
        </CollapsibleSection>
      ) : null}

      <CollapsibleSection title="Advanced analysis" hint="Volcano · cell embedding · full metrics · formulas" defaultOpen={false} level="advanced">
        {(hasFDR || volcanoGenes?.some((g) => g.p_value != null)) ? (
          <section className="detail-volcano detail-volcano-advanced">
            <VolcanoPanel
              genes={volcano && volcano.length ? volcano : volcanoGenes}
              selectedGene={gene.gene}
              onSelect={onSelectGene}
              hasFDR={hasFDR}
              isFullSet={isFullVolcano}
            />
          </section>
        ) : null}

        {umap && umap.length ? (
          <div style={{ marginTop: 24 }}>
            <h4 className="section-heading" style={{ marginBottom: 4 }}>Cell embedding</h4>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>{umapLabel}</p>
            <UmapPanel points={umap} geneCols={umapGeneCols} selectedGene={gene.gene} />
          </div>
        ) : null}

        {showCrossCohort && crossCohort ? (
          <div style={{ marginTop: 24 }}>
            <CrossCohortPanel rows={crossCohort} onSelect={onSelectGene} />
          </div>
        ) : null}

        {metricRows.length ? (
          <div style={{ marginTop: 24 }}>
            <h4 className="section-heading" style={{ marginBottom: 12 }}>Full metric table</h4>
            <div className="compare-table-wrap">
              <table className="compare-table metric-table">
                <tbody>
                  {metricRows.map((r) => (
                    <tr key={r.k}>
                      <td>{r.label}</td>
                      <td>{fmt(r.v, r.d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 28 }}>
          <h4 className="section-heading" style={{ marginBottom: 12 }}>Ranking formulas</h4>
          {Object.keys(RANK_METRICS).map((k) => (
            <div key={k} style={{ marginBottom: 16 }}>
              <FormulaPanel rankMetric={k} compact />
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}
