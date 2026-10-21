function titleCase(s) {
  if (!s) return "—";
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function Header({
  info,
  query,
  setQuery,
  nCandidates,
  nTotal,
  loading,
  diseaseOptions = [],
  diseaseId,
  onDiseaseChange,
  rankSource = "public",
  hasZip = false,
  onRankSource,
}) {
  const donors = info?.n_donors || {};

  const stats = [
    {
      label: "Genes ranked",
      value: loading ? "…" : nCandidates ?? "—",
      delta: !loading && nCandidates !== nTotal ? `of ${nTotal}` : "after filters",
      bubble: "☰",
    },
    {
      label: info?.source === "bulk" ? "Pathogenic libraries" : "Pathogenic donors",
      value: donors.P ?? "—",
      delta: "disease arm",
      bubble: "P",
    },
    {
      label: info?.source === "bulk" ? "Healthy libraries" : "Healthy donors",
      value: donors.H ?? "—",
      delta: "reference arm",
      bubble: "H",
    },
  ];

  return (
    <>
      <div className="topbar ranking-topbar">
        <div className="hello">
          <h2>{titleCase(info?.disease)}</h2>
          {diseaseOptions.length ? (
            <select
              aria-label="Disease"
              className="ranking-disease"
              value={diseaseId}
              onChange={(e) => onDiseaseChange?.(e.target.value)}
            >
              {diseaseOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                  {d.optionNote
                    ? ` · ${d.optionNote}`
                    : d.n_cohorts
                      ? ` · ${d.n_cohorts} cohorts`
                      : ""}
                </option>
              ))}
            </select>
          ) : null}
          {onRankSource ? (
            <div className="rank-source" role="tablist" aria-label="Ranking source">
              <button
                type="button"
                className={`chip${rankSource === "public" ? " active" : ""}`}
                onClick={() => onRankSource("public")}
              >
                CELLxGENE
              </button>
              <button
                type="button"
                className={`chip${rankSource === "bulk" ? " active" : ""}`}
                onClick={() => onRankSource("bulk")}
              >
                {hasZip ? "Your zip" : "Add zip"}
              </button>
            </div>
          ) : null}
        </div>
        <div className="search">
          <span>⌕</span>
          <input
            id="search"
            type="search"
            placeholder="Search a gene, e.g. POSTN"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            aria-label="Search gene"
          />
        </div>
      </div>

      <section className="metrics">
        {stats.map((item) => (
          <div className="metric" key={item.label}>
            <div className="bubble">{item.bubble}</div>
            <div>
              <div className="label">{item.label}</div>
              <div className="value">{item.value}</div>
              <div className="delta">{item.delta}</div>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
