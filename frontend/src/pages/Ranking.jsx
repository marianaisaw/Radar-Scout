import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import FlowChrome from "../FlowChrome.jsx";
import { FIBROSIS, fibrosisById } from "../diseases.js";
import { useGene } from "../gene-context.jsx";
import Header from "../scout/components/Header.jsx";
import GeneList from "../scout/components/GeneList.jsx";
import Filters from "../scout/components/Filters.jsx";
import DetailPanel from "../scout/components/DetailPanel.jsx";
import ComparePanel from "../scout/components/ComparePanel.jsx";
import ComparisonPanel from "../scout/components/ComparisonPanel.jsx";
import CuteLoad from "../CuteLoad.jsx";
import { RANK_METRICS, exportCsv, hasCol, extent } from "../scout/lib/utils.js";
import "../scout/scout.css";

const BASE_FILTERS = { RACS: 0, Feas: 0, Sep: 0, Repro: 0, OffMax: 1, detect_P: 0, log2FC: 0 };
const UMAP_META_KEYS = new Set(["UMAP1", "UMAP2", "cell_type", "pop", "donor"]);

export default function Ranking() {
  const { disease } = useParams();
  const fibro = fibrosisById(disease);
  const navigate = useNavigate();
  const { openGene, setFibrosisId, setIsoformChoice, bulkCohort, rankSource, setRankSource } = useGene();

  const [diseases, setDiseases] = useState(null);
  const [genes, setGenes] = useState(null);
  const [umap, setUmap] = useState(null);
  const [volcano, setVolcano] = useState(null);
  const [ctExpr, setCtExpr] = useState(null);
  const [crossCohort, setCrossCohort] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [rankMetric, setRankMetric] = useState("spec_score");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("spec_score");
  const [sortDir, setSortDir] = useState("desc");
  const [filters, setFilters] = useState(BASE_FILTERS);
  const [selected, setSelected] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState([]);

  const base = import.meta.env.BASE_URL || "/";
  const activeKey = fibro.key;

  useEffect(() => {
    setFibrosisId(fibro.id);
  }, [fibro.id, setFibrosisId]);

  useEffect(() => {
    Promise.all([
      fetch(`${base}data/diseases.json`).then((r) => {
        if (!r.ok) throw new Error(`diseases.json ${r.status}`);
        return r.json();
      }),
      fetch(`${base}data/cross_cohort.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([manifest, xc]) => {
        setDiseases(manifest?.diseases || []);
        setCrossCohort(xc);
      })
      .catch((e) => setError(e.message));
  }, [base]);

  const hasZip = Boolean(bulkCohort?.genes?.length && bulkCohort.diseaseId === fibro.id);
  const usingBulk = hasZip && rankSource === "bulk";

  function bulkDetectFromCpm(row) {
    const occP = row.mean_P / (row.mean_P + 5);
    const occH = row.mean_H / (row.mean_H + 5);
    const detect_P = 100 * occP;
    const detect_H = 100 * occH;
    const log2FC = Math.log2((row.mean_P + 1) / (row.mean_H + 1));
    const spec_score = Math.max(log2FC, 0) * Math.max(occP - occH, 0);
    const DSS = Math.max(log2FC, 0) * Math.log10(row.mean_P + 1);
    return {
      ...row,
      log2FC: Number(log2FC.toFixed(4)),
      spec_score: Number(spec_score.toFixed(4)),
      DSS: Number(DSS.toFixed(4)),
      detect_P: Number(detect_P.toFixed(2)),
      detect_H: Number(detect_H.toFixed(2)),
      delta_detect: Number((detect_P - detect_H).toFixed(2)),
      tpm_P: undefined,
      tpm_H: undefined,
      tpm_B: undefined,
    };
  }

  const info = useMemo(() => {
    const found = diseases ? diseases.find((d) => d.key === activeKey) : null;
    if (!usingBulk) return found;
    const pLabel = (bulkCohort.groups?.P || [])
      .map((sample) => bulkCohort.labels?.[sample] || sample)
      .join(", ");
    const hLabel = (bulkCohort.groups?.H || [])
      .map((sample) => bulkCohort.labels?.[sample] || sample)
      .join(", ");
    return {
      ...(found || { key: activeKey, disease: fibro.short.toLowerCase() }),
      source: "bulk",
      n_cohorts: 1,
      has_umap: false,
      n_donors: {
        P: bulkCohort.groups?.P?.length || 0,
        H: bulkCohort.groups?.H?.length || 0,
      },
      cohorts: [
        {
          key: "bulk",
          cohort: bulkCohort.filename,
          cell_type: "bulk RNA-seq",
          comparison: {
            p_label: pLabel || "Pathogenic libraries",
            ref_label: hLabel || "Healthy libraries",
            ref_kind: "healthy",
            unit: "libraries",
            p_donors: bulkCohort.groups?.P?.length || 0,
            p_cells: bulkCohort.groups?.P?.length || 0,
            ref_donors: bulkCohort.groups?.H?.length || 0,
            ref_cells: bulkCohort.groups?.H?.length || 0,
          },
        },
      ],
    };
  }, [diseases, activeKey, usingBulk, bulkCohort, fibro.short]);

  useEffect(() => {
    if (usingBulk) {
      setLoading(false);
      setError(null);
      setGenes(bulkCohort.genes.map(bulkDetectFromCpm));
      setUmap(null);
      setVolcano(null);
      setCtExpr(null);
      setQuery("");
      setFilters(BASE_FILTERS);
      setCompareOpen(false);
      const top = [...bulkCohort.genes].sort(
        (a, b) => (b.spec_score ?? -Infinity) - (a.spec_score ?? -Infinity),
      )[0];
      setSelected(top?.gene ?? bulkCohort.genes[0]?.gene ?? null);
      setCompareIds([]);
      return;
    }
    if (!info) return;
    let cancelled = false;
    setLoading(true);
    setGenes(null);
    setUmap(null);
    setVolcano(null);
    setCtExpr(null);
    setQuery("");
    setFilters(BASE_FILTERS);
    setCompareOpen(false);

    const jobs = [
      fetch(`${base}data/${info.key}_racs.json`).then((r) => {
        if (!r.ok) throw new Error(`${info.key}_racs.json ${r.status}`);
        return r.json();
      }),
    ];
    const umapKey = info.has_umap && info.umap_key ? info.umap_key : null;
    jobs.push(
      umapKey
        ? fetch(`${base}data/${umapKey}_umap.json`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
    );
    jobs.push(
      fetch(`${base}data/${info.key}_volcano.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
    jobs.push(
      fetch(`${base}data/${info.key}_celltype_expr.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );

    Promise.all(jobs)
      .then(([racs, um, vol, ct]) => {
        if (cancelled) return;
        setGenes(racs);
        setUmap(um);
        setVolcano(vol);
        setCtExpr(ct);
        const topSensor = [...racs].sort(
          (a, b) => (b.spec_score ?? -Infinity) - (a.spec_score ?? -Infinity),
        )[0];
        setSelected(topSensor?.gene ?? (racs.length ? racs[0].gene : null));
        setCompareIds([]);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [info, base, usingBulk, bulkCohort]);

  const hasFDR = useMemo(() => hasCol(genes, "FDR"), [genes]);
  const isKeloid = info?.disease === "keloid";

  useEffect(() => {
    if (genes && !hasCol(genes, rankMetric)) {
      const fallback = Object.keys(RANK_METRICS).find((k) => hasCol(genes, k));
      if (fallback) setRankMetric(fallback);
    }
  }, [genes, rankMetric]);

  useEffect(() => {
    if (genes && sortKey && !hasCol(genes, sortKey)) setSortKey(rankMetric);
  }, [genes, sortKey, rankMetric]);

  useEffect(() => {
    setSortKey(rankMetric);
    setSortDir("desc");
  }, [rankMetric]);

  const bounds = useMemo(() => {
    if (!genes) return null;
    const rows = usingBulk ? genes.map(bulkDetectFromCpm) : genes;
    return {
      detect_P: extent(rows, "detect_P"),
      log2FC: extent(rows, "log2FC"),
    };
  }, [genes, usingBulk]);

  const ranked = useMemo(() => {
    if (!genes) return [];
    const rows = usingBulk ? genes.map(bulkDetectFromCpm) : genes;
    const mk = rankMetric;
    const byMetric = [...rows].sort((a, b) => (b[mk] ?? -Infinity) - (a[mk] ?? -Infinity));
    const rankMap = new Map(byMetric.map((g, i) => [g.gene, i + 1]));
    return rows.map((g) => ({ ...g, _rank: rankMap.get(g.gene) }));
  }, [genes, rankMetric, usingBulk]);

  const sensorRankMap = useMemo(() => {
    if (!genes) return new Map();
    const sorted = [...genes].sort((a, b) => (b.spec_score ?? -Infinity) - (a.spec_score ?? -Infinity));
    return new Map(sorted.map((g, i) => [g.gene, i + 1]));
  }, [genes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const geq = (v, t) => v === undefined || v === null || v >= t;
    const leq = (v, t) => v === undefined || v === null || v <= t;
    let out = ranked.filter(
      (g) =>
        geq(g.RACS, filters.RACS) &&
        geq(g.Feas, filters.Feas) &&
        geq(g.Sep, filters.Sep) &&
        geq(g.Repro, filters.Repro) &&
        leq(g.OffMax, filters.OffMax) &&
        geq(g.detect_P, filters.detect_P) &&
        geq(g.log2FC, filters.log2FC),
    );
    if (q) out = out.filter((g) => g.gene.toLowerCase().includes(q));
    const dir = sortDir === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === bv) return (a._rank ?? 0) - (b._rank ?? 0);
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      return (av < bv ? -1 : 1) * dir;
    });
    return out;
  }, [ranked, filters, query, sortKey, sortDir]);

  const maxMetric = useMemo(() => {
    const mk = rankMetric;
    return ranked.length ? Math.max(...ranked.map((g) => g[mk] ?? 0)) : 0;
  }, [ranked, rankMetric]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.RACS > 0) n += 1;
    if (filters.Feas > 0) n += 1;
    if (filters.Sep > 0) n += 1;
    if (filters.Repro > 0) n += 1;
    if (filters.OffMax < 1) n += 1;
    if (filters.detect_P > 0) n += 1;
    if (filters.log2FC > 0) n += 1;
    return n;
  }, [filters]);

  const selectedGene = useMemo(() => ranked.find((g) => g.gene === selected) || null, [ranked, selected]);
  const compareGenes = useMemo(
    () => compareIds.map((id) => ranked.find((g) => g.gene === id)).filter(Boolean),
    [ranked, compareIds],
  );

  const umapGeneCols = useMemo(() => {
    if (!umap || !umap.length) return [];
    return Object.keys(umap[0]).filter((k) => !UMAP_META_KEYS.has(k));
  }, [umap]);

  const umapCohort = useMemo(
    () => info?.cohorts?.find((c) => c.key === info.umap_key) || null,
    [info],
  );

  useEffect(() => {
    if (selected && !filtered.some((g) => g.gene === selected) && filtered.length) {
      setSelected(filtered[0].gene);
    }
  }, [filtered, selected]);

  const onSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir(key === "OffMax" ? "asc" : "desc");
      if (RANK_METRICS[key]) setRankMetric(key);
    }
  };

  const toggleCompare = (id) =>
    setCompareIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length >= 4) return ids;
      return [...ids, id];
    });

  const selectGene = (g) => {
    setSelected(g);
    setCompareOpen(false);
  };

  const designSensors = (geneName) => {
    openGene(geneName);
    setIsoformChoice(null);
    navigate("/design/candidates");
  };

  const diseaseOptions = FIBROSIS.map((item) => ({
    ...item,
    n_cohorts: diseases?.find((d) => d.key === item.key)?.n_cohorts,
  }));

  return (
    <FlowChrome step={3} disease={fibro.id} wide>
      <div className="kyle-dash ranking-page">
        {error ? (
          <div className="error">Failed to load ranking: {error}</div>
        ) : !diseases ? (
          <CuteLoad label="Loading disease ranking…" />
        ) : (
          <>
                <Header
                  info={info}
                  query={query}
                  setQuery={setQuery}
                  nCandidates={filtered.length}
                  nTotal={ranked.length}
                  loading={loading}
                  diseaseOptions={diseaseOptions}
                  diseaseId={fibro.id}
                  onDiseaseChange={(id) => navigate(`/ranking/${id}`)}
                  rankSource={usingBulk ? "bulk" : "public"}
                  hasZip={hasZip}
                  onRankSource={(next) => {
                    if (next === "bulk" && !hasZip) {
                      navigate(`/upload/${fibro.id}`);
                      return;
                    }
                    setRankSource(next);
                  }}
                />

                {loading ? (
                  <CuteLoad
                    label={`Ranking ${info?.disease || fibro.label}${
                      info?.n_cohorts ? ` · ${info.n_cohorts} cohort${info.n_cohorts > 1 ? "s" : ""}` : ""
                    }`}
                  />
                ) : (
                  <div className="ranking-workspace">
                    <aside className="card workspace-ranks">
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
                        bulk={usingBulk}
                      />
                      <Filters
                        filters={filters}
                        setFilters={setFilters}
                        activeCount={activeFilterCount}
                        defaults={BASE_FILTERS}
                        bounds={bounds}
                        scRna={!usingBulk}
                      />
                      <div className="sidebar-footer">
                        <button
                          type="button"
                          className="chip"
                          onClick={() => exportCsv(filtered, `${activeKey}_filtered.csv`)}
                        >
                          Export CSV
                        </button>
                        {compareOpen ? (
                          <button
                            type="button"
                            className="chip active"
                            onClick={() => setCompareOpen(false)}
                          >
                            Exit compare
                          </button>
                        ) : null}
                      </div>
                    </aside>

                    <main className="card workspace-detail">
                      {compareOpen ? (
                        <>
                        <ComparisonPanel key={activeKey} info={info} />
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
                        </>
                      ) : (
                        <>
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
                            umapLabel={`${umapCohort?.cell_type ?? info?.disease} · ${umapCohort?.cohort ?? "Single-cell atlas"}`}
                            crossCohort={crossCohort}
                            showCrossCohort={isKeloid && crossCohort}
                            context={<ComparisonPanel key={activeKey} info={info} />}
                            actions={
                              selectedGene ? (
                                <>
                                  <button
                                    type="button"
                                    className="chip"
                                    onClick={() => {
                                      toggleCompare(selectedGene.gene);
                                      setCompareOpen(true);
                                    }}
                                  >
                                    Compare
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    onClick={() => designSensors(selectedGene.gene)}
                                  >
                                    Design sensors
                                  </button>
                                </>
                              ) : null
                            }
                          />
                        </>
                      )}
                    </main>
                  </div>
                )}
          </>
        )}
      </div>
    </FlowChrome>
  );
}
