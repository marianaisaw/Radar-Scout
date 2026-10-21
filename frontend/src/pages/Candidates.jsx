import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useGene } from "../gene-context.jsx";
import { loadSaved, storeSaved } from "../saved.js";
import { CANDIDATE_COLUMNS, cellClass, formatCell } from "../columns.js";
import CuteLoad from "../CuteLoad.jsx";
import IsoformExpression from "../IsoformExpression.jsx";

export default function Candidates() {
  const {
    gene,
    overview,
    isoformFilter,
    filters,
    sort,
    descending,
    page,
    setPage,
    geneError,
    isoformChoice,
    setIsoformChoice,
    setIsoformFilter,
  } = useGene();
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [inspect, setInspect] = useState(null);
  const [presence, setPresence] = useState(null);
  const [saved, setSaved] = useState(loadSaved);

  useEffect(() => {
    setInspect(null);
    setPresence(null);
    setError("");
    setResult(null);
    setLoading(true);
  }, [gene]);

  const searchBody = useMemo(() => {
    if (!overview || !filters) return null;
    return {
      gene,
      page,
      page_size: 8,
      sort,
      descending,
      isoforms: isoformFilter ?? overview.isoforms,
      ...filters,
    };
  }, [overview, filters, gene, page, sort, descending, isoformFilter]);

  useEffect(() => {
    if (!searchBody) return;
    let cancelled = false;
    setLoading(true);
    api
      .search(searchBody)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [searchBody]);

  const rows = useMemo(() => {
    const all = result?.rows || [];
    if (!q.trim()) return all;
    const needle = q.toLowerCase();
    return all.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
  }, [result, q]);

  function toggleSave(row) {
    const exists = saved.some((item) => item.id === row.id);
    const payload = { ...row, gene };
    const next = exists ? saved.filter((item) => item.id !== row.id) : [...saved, payload];
    setSaved(next);
    storeSaved(next);
  }

  async function inspectRow(row) {
    setInspect(row);
    setPresence(await api.site(gene, row.matches || ""));
  }

  async function downloadCsv() {
    if (!searchBody) return;
    await api.exportCsv({ ...searchBody, page: 1, page_size: 50 });
  }

  const waiting = Boolean(gene) && !geneError && !error && (loading || !overview || !filters || result == null);
  const pages = result?.pages || 1;
  const pageButtons = [];
  const last = pages;
  const windowStart = Math.max(1, Math.min(page - 1, Math.max(1, last - 3)));
  for (let i = windowStart; i <= Math.min(last, windowStart + 3); i += 1) pageButtons.push(i);

  const summary = overview?.summary || {};

  if (!isoformChoice) {
    return (
      <IsoformExpression
        footer={({ ids }) => (
          <>
            <p>Use these expressed isoforms, or choose your own in the table?</p>
            <div className="toolbar">
              <button
                className="btn"
                type="button"
                disabled={!ids.length}
                onClick={() => {
                  setIsoformFilter(ids);
                  setIsoformChoice("expressed");
                }}
              >
                Use these isoforms
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setIsoformChoice("custom")}
              >
                Choose my own
              </button>
            </div>
          </>
        )}
      />
    );
  }

  const total = waiting ? "…" : (summary.total_candidates || 0).toLocaleString();
  const transcripts = waiting ? "…" : summary.total_unique_transcripts || 0;
  const oneIsoform = waiting ? "…" : (summary.matching_one || 0).toLocaleString();
  const passing = waiting ? "…" : (result?.total || 0).toLocaleString();
  const unfiltered = waiting ? "" : (result?.unfiltered || 0).toLocaleString();

  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <h3>All candidates</h3>
            <div className="sub">
              {gene} · {total} total · {transcripts} transcripts · {oneIsoform} one-isoform · {saved.length} saved
              {unfiltered ? ` · ${passing} of ${unfiltered} passing` : ""}
            </div>
          </div>
          <div className="toolbar">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
            <button className="btn ghost" type="button" onClick={downloadCsv}>
              CSV
            </button>
          </div>
        </div>

        {(geneError || error) && <div className="error">{geneError || error}</div>}
        {waiting ? (
          <CuteLoad label={`Fetching ${gene}…`} />
        ) : geneError || error ? null : (
        <>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>save</th>
                {CANDIDATE_COLUMNS.map((key) => (
                  <th key={key}>{key}</th>
                ))}
                <th>isoforms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSaved = saved.some((item) => item.id === row.id);
                const inspecting = inspect?.id === row.id;
                return (
                  <tr key={row.id}>
                    <td>
                      <button className={isSaved ? "pill on" : "btn ghost"} onClick={() => toggleSave(row)}>
                        {isSaved ? "Saved" : "Save"}
                      </button>
                    </td>
                    {CANDIDATE_COLUMNS.map((key) => (
                      <td key={key} className={cellClass(key)}>
                        {formatCell(key, row[key])}
                      </td>
                    ))}
                    <td>
                      <button className={inspecting ? "pill on" : "pill purple"} onClick={() => inspectRow(row)}>
                        Isoforms
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="notice">No sensor matches for {gene} with the current filters.</div>}
        </div>
        <div className="pager">
          <span>
            {result && result.total ? (result.page - 1) * result.page_size + 1 : 0}–
            {Math.min((result?.page || 1) * (result?.page_size || 8), result?.total || 0)} of{" "}
            {(result?.total || 0).toLocaleString()}
          </span>
          <div className="pages">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))}>&lt;</button>
            {pageButtons[0] > 1 && (
              <>
                <button onClick={() => setPage(1)}>1</button>
                {pageButtons[0] > 2 && <span>…</span>}
              </>
            )}
            {pageButtons.map((n) => (
              <button key={n} className={n === page ? "active" : ""} onClick={() => setPage(n)}>
                {n}
              </button>
            ))}
            {pageButtons[pageButtons.length - 1] < last && (
              <>
                {pageButtons[pageButtons.length - 1] < last - 1 && <span>…</span>}
                <button onClick={() => setPage(last)}>{last}</button>
              </>
            )}
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))}>&gt;</button>
          </div>
        </div>

        {inspect && presence && (
          <div className="drawer">
            <strong>Isoforms</strong>
            <p className="sub">
              {presence.present}/{presence.total} · {inspect.region_type} · {inspect.variant} · {inspect.length} nt
            </p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Transcript</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {presence.isoforms.map((item) => (
                    <tr key={item.ensembl_transcript}>
                      <td className="mono">{item.ensembl_transcript}</td>
                      <td>
                        <span className={`pill ${item.site_present ? "on" : "off"}`}>
                          {item.site_present ? "yes" : "no"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
        )}
      </section>
    </>
  );
}
