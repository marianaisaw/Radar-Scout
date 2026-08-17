import { donorRangeFromCohorts } from '../lib/utils'

function titleCase(s) {
  if (!s) return '—'
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function Header({
  info,
  query,
  setQuery,
  nCandidates,
  nTotal,
  loading,
}) {
  const cohorts = info?.cohorts || []
  const pRange = donorRangeFromCohorts(cohorts, 'p_donors')
  const hRange = donorRangeFromCohorts(cohorts, 'ref_donors')

  const kpis = [
    { label: 'Cohorts', value: info?.n_cohorts ?? '—', accent: 'teal' },
    {
      label: 'Targets',
      value: loading ? '…' : `${nCandidates}${!loading && nCandidates !== nTotal ? ` / ${nTotal}` : ''}`,
      accent: 'hero',
    },
    { label: 'Pathogenic donors', value: pRange?.label ?? '—', hint: 'Per cohort', accent: 'crimson' },
    { label: 'Reference donors', value: hRange?.label ?? '—', hint: 'Per cohort', accent: 'teal' },
  ]

  return (
    <header className="dashboard-header">
      <div className="dashboard-topbar">
        <div className="topbar-brand">
          <h1>
            RADAR<span className="accent">·</span>Scout
          </h1>
        </div>

        <div className="topbar-context">
          <h2 className="topbar-disease">{titleCase(info?.disease)}</h2>
          <span className="topbar-context-sub">Sensor-ranked RNA targets</span>
        </div>
      </div>

      <div className="dashboard-kpi-row">
        <div className="dashboard-kpis">
          {kpis.map((k) => (
            <div key={k.label} className={`kpi-card accent-${k.accent}`} title={k.hint}>
              <span className="kpi-label">{k.label}</span>
              <span className="kpi-value">{k.value}</span>
              {k.hint ? <span className="kpi-hint">{k.hint}</span> : null}
            </div>
          ))}
        </div>

        <div className="topbar-search-wrap kpi-row-search">
          <input
            id="search"
            className="search topbar-search"
            type="search"
            placeholder="Search gene…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search gene"
          />
        </div>
      </div>
    </header>
  )
}
