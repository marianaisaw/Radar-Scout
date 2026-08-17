import { useEffect, useMemo, useState } from 'react'
import Header from './components/Header'
import DiseaseNav from './components/DiseaseNav'
import GeneList from './components/GeneList'
import Filters from './components/Filters'
import DetailPanel from './components/DetailPanel'
import ComparePanel from './components/ComparePanel'
import ComparisonPanel from './components/ComparisonPanel'
import { RANK_METRICS, exportCsv, hasCol, extent } from './lib/utils'

const BASE_FILTERS = { RACS: 0, Feas: 0, Sep: 0, Repro: 0, OffMax: 1, detect_P: 0, log2FC: 0 }

const UMAP_META_KEYS = new Set(['UMAP1', 'UMAP2', 'cell_type', 'pop', 'donor'])

export default function App() {
  const [diseases, setDiseases] = useState(null)
  const [activeKey, setActiveKey] = useState(null)
  const [genes, setGenes] = useState(null)
  const [umap, setUmap] = useState(null)
  const [volcano, setVolcano] = useState(null)
  const [ctExpr, setCtExpr] = useState(null)
  const [crossCohort, setCrossCohort] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Sensor is the primary ranking lens
  const [rankMetric, setRankMetric] = useState('spec_score')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('spec_score')
  const [sortDir, setSortDir] = useState('desc')
  const [filters, setFilters] = useState(BASE_FILTERS)
  const [selected, setSelected] = useState(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareIds, setCompareIds] = useState([])

  const base = import.meta.env.BASE_URL || '/'

  useEffect(() => {
    Promise.all([
      fetch(`${base}data/diseases.json`).then((r) => {
        if (!r.ok) throw new Error(`diseases.json ${r.status}`)
        return r.json()
      }),
      fetch(`${base}data/cross_cohort.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([manifest, xc]) => {
        const list = manifest?.diseases || []
        setDiseases(list)
        setCrossCohort(xc)
        const defaultKey =
          list.find((d) => d.key === 'keloid_pooled' || d.disease === 'keloid')?.key ?? list[0]?.key
        if (defaultKey) setActiveKey(defaultKey)
      })
      .catch((e) => setError(e.message))
  }, [])

  const info = useMemo(
    () => (diseases && activeKey ? diseases.find((d) => d.key === activeKey) : null),
    [diseases, activeKey],
  )

  useEffect(() => {
    if (!info) return
    let cancelled = false
    setLoading(true)
    setGenes(null)
    setUmap(null)
    setVolcano(null)
    setCtExpr(null)

    const jobs = [
      fetch(`${base}data/${info.key}_racs.json`).then((r) => {
        if (!r.ok) throw new Error(`${info.key}_racs.json ${r.status}`)
        return r.json()
      }),
    ]
    const umapKey = info.has_umap && info.umap_key ? info.umap_key : null
    jobs.push(
      umapKey
        ? fetch(`${base}data/${umapKey}_umap.json`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
    )
    jobs.push(
      fetch(`${base}data/${info.key}_volcano.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    )
    jobs.push(
      fetch(`${base}data/${info.key}_celltype_expr.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    )

    Promise.all(jobs)
      .then(([racs, um, vol, ct]) => {
        if (cancelled) return
        setGenes(racs)
        setUmap(um)
        setVolcano(vol)
        setCtExpr(ct)
        const topSensor = [...racs].sort(
          (a, b) => (b.spec_score ?? -Infinity) - (a.spec_score ?? -Infinity),
        )[0]
        setSelected(topSensor?.gene ?? (racs.length ? racs[0].gene : null))
        setCompareIds([])
        setLoading(false)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [info])

  const hasFDR = useMemo(() => hasCol(genes, 'FDR'), [genes])
  const isKeloid = info?.disease === 'keloid'

  useEffect(() => {
    if (genes && !hasCol(genes, rankMetric)) {
      const fallback = Object.keys(RANK_METRICS).find((k) => hasCol(genes, k))
      if (fallback) setRankMetric(fallback)
    }
  }, [genes, rankMetric])

  useEffect(() => {
    if (genes && sortKey && !hasCol(genes, sortKey)) setSortKey(rankMetric)
  }, [genes, sortKey, rankMetric])

  useEffect(() => {
    setSortKey(rankMetric)
    setSortDir('desc')
  }, [rankMetric])

  const bounds = useMemo(() => {
    if (!genes) return null
    return {
      detect_P: extent(genes, 'detect_P'),
      log2FC: extent(genes, 'log2FC'),
    }
  }, [genes])

  const ranked = useMemo(() => {
    if (!genes) return []
    const mk = rankMetric
    const byMetric = [...genes].sort((a, b) => (b[mk] ?? -Infinity) - (a[mk] ?? -Infinity))
    const rankMap = new Map(byMetric.map((g, i) => [g.gene, i + 1]))
    return genes.map((g) => ({ ...g, _rank: rankMap.get(g.gene) }))
  }, [genes, rankMetric])

  const sensorRankMap = useMemo(() => {
    if (!genes) return new Map()
    const sorted = [...genes].sort((a, b) => (b.spec_score ?? -Infinity) - (a.spec_score ?? -Infinity))
    return new Map(sorted.map((g, i) => [g.gene, i + 1]))
  }, [genes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const geq = (v, t) => v === undefined || v === null || v >= t
    const leq = (v, t) => v === undefined || v === null || v <= t
    let out = ranked.filter(
      (g) =>
        geq(g.RACS, filters.RACS) &&
        geq(g.Feas, filters.Feas) &&
        geq(g.Sep, filters.Sep) &&
        geq(g.Repro, filters.Repro) &&
        leq(g.OffMax, filters.OffMax) &&
        geq(g.detect_P, filters.detect_P) &&
        geq(g.log2FC, filters.log2FC),
    )
    if (q) out = out.filter((g) => g.gene.toLowerCase().includes(q))
    const dir = sortDir === 'desc' ? -1 : 1
    out = [...out].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av === bv) return (a._rank ?? 0) - (b._rank ?? 0)
      if (av === undefined || av === null) return 1
      if (bv === undefined || bv === null) return -1
      return (av < bv ? -1 : 1) * dir
    })
    return out
  }, [ranked, filters, query, sortKey, sortDir])

  const maxMetric = useMemo(() => {
    const mk = rankMetric
    return ranked.length ? Math.max(...ranked.map((g) => g[mk] ?? 0)) : 0
  }, [ranked, rankMetric])

  const activeFilterCount = useMemo(() => {
    let n = 0
    if (filters.RACS > 0) n++
    if (filters.Feas > 0) n++
    if (filters.Sep > 0) n++
    if (filters.Repro > 0) n++
    if (filters.OffMax < 1) n++
    if (filters.detect_P > 0) n++
    if (filters.log2FC > 0) n++
    return n
  }, [filters])

  const selectedGene = useMemo(
    () => ranked.find((g) => g.gene === selected) || null,
    [ranked, selected],
  )
  const compareGenes = useMemo(
    () => compareIds.map((id) => ranked.find((g) => g.gene === id)).filter(Boolean),
    [ranked, compareIds],
  )

  const umapGeneCols = useMemo(() => {
    if (!umap || !umap.length) return []
    return Object.keys(umap[0]).filter((k) => !UMAP_META_KEYS.has(k))
  }, [umap])

  const umapCohort = useMemo(
    () => info?.cohorts?.find((c) => c.key === info.umap_key) || null,
    [info],
  )

  useEffect(() => {
    if (selected && !filtered.some((g) => g.gene === selected) && filtered.length) {
      setSelected(filtered[0].gene)
    }
  }, [filtered, selected])

  const onSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'OffMax' ? 'asc' : 'desc')
      if (RANK_METRICS[key]) setRankMetric(key)
    }
  }

  const toggleCompare = (id) =>
    setCompareIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id)
      if (ids.length >= 4) return ids
      return [...ids, id]
    })

  const selectGene = (g) => {
    setSelected(g)
    setCompareOpen(false)
  }

  if (error) {
    return (
      <div className="dashboard-shell">
        <div className="error">
          Failed to load data: {error}
          <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Ensure <code>public/data/diseases.json</code> and the per-disease files exist, then reload.
          </div>
        </div>
      </div>
    )
  }

  if (!diseases) {
    return (
      <div className="dashboard-shell">
        <div className="dashboard-loading">Loading disease manifest…</div>
      </div>
    )
  }

  return (
    <div className="dashboard-shell">
      <div className="dashboard-frame">
      <DiseaseNav diseases={diseases} activeKey={activeKey} setActiveKey={setActiveKey} />

      <div className="dashboard-content">
        <Header
          info={info}
          query={query}
          setQuery={setQuery}
          nCandidates={filtered.length}
          nTotal={ranked.length}
          loading={loading}
        />

        {loading ? (
          <div className="dashboard-loading">
            Loading {info?.disease}
            {info?.n_cohorts ? ` · ${info.n_cohorts} cohort${info.n_cohorts > 1 ? 's' : ''}` : ''}…
          </div>
        ) : (
          <div className="dashboard-workspace">
            <aside className="workspace-ranks">
              <GeneList
                genes={filtered}
                maxMetric={maxMetric}
                rankMetric={rankMetric}
                selected={selected}
                onSelect={setSelected}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                compareIds={compareIds}
                onToggleCompare={toggleCompare}
                compareEnabled={compareOpen}
              />
              <Filters
                filters={filters}
                setFilters={setFilters}
                activeCount={activeFilterCount}
                defaults={BASE_FILTERS}
                bounds={bounds}
              />
              <div className="sidebar-footer">
                <button
                  type="button"
                  className="chip"
                  onClick={() => exportCsv(filtered, `${activeKey}_filtered.csv`)}
                >
                  Export CSV ({filtered.length})
                </button>
                <button
                  type="button"
                  className={`chip${compareOpen ? ' active' : ''}`}
                  onClick={() => setCompareOpen((o) => !o)}
                >
                  {compareOpen ? 'Exit compare' : 'Compare'}
                </button>
              </div>
            </aside>

            <main className="workspace-detail">
              <ComparisonPanel key={activeKey} info={info} />

              {compareOpen ? (
                <div className="panel dashboard-panel">
                  <div className="panel-head">
                    <h2>Compare targets</h2>
                    <span className="hint">Up to 4 genes</span>
                  </div>
                  <ComparePanel
                    genes={compareGenes}
                    onRemove={(id) => toggleCompare(id)}
                    onClear={() => setCompareIds([])}
                  />
                </div>
              ) : (
                <>
                  {selectedGene ? (
                    <div className="main-toolbar">
                      <span className="main-toolbar-label">Selected target</span>
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          toggleCompare(selectedGene.gene)
                          setCompareOpen(true)
                        }}
                      >
                        Add {selectedGene.gene} to compare
                      </button>
                    </div>
                  ) : null}
                  <DetailPanel
                    gene={selectedGene}
                    allGenes={ranked}
                    rank={selectedGene ? sensorRankMap.get(selectedGene.gene) : null}
                    totalGenes={ranked.length}
                    cohorts={info?.cohorts || []}
                    nCohorts={info?.n_cohorts}
                    ctExpr={ctExpr}
                    pathogenicHint={info?.cohorts?.[0]?.comparison?.cell_type}
                    volcano={volcano}
                    volcanoGenes={genes}
                    hasFDR={hasFDR}
                    isFullVolcano={Boolean(volcano && volcano.length)}
                    onSelectGene={selectGene}
                    umap={info?.has_umap && umap?.length ? umap : null}
                    umapGeneCols={umapGeneCols}
                    umapLabel={`${umapCohort?.cell_type ?? info?.disease} · ${umapCohort?.cohort ?? 'Single-cell atlas'}`}
                    crossCohort={crossCohort}
                    showCrossCohort={isKeloid && crossCohort}
                  />
                </>
              )}
            </main>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
