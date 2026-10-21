import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { useGene } from "./gene-context.jsx";
import { fibrosisById } from "./diseases.js";
import CuteLoad from "./CuteLoad.jsx";

const COLORS = ["#e11d2a", "#2563eb", "#7c5cbf", "#c01020", "#1d4ed8", "#c4b5fd", "#60a5fa"];
const FALLBACK_TISSUE = "Cells - Cultured fibroblasts";

export default function IsoformExpression({ footer }) {
  const { gene, fibrosisId, geneAlias } = useGene();
  const fibro = fibrosisById(fibrosisId);
  const preferredTissue = fibro.gtexTissue || FALLBACK_TISSUE;
  const [data, setData] = useState(null);
  const [tissue, setTissue] = useState(preferredTissue);
  const [error, setError] = useState("");

  useEffect(() => {
    setTissue(preferredTissue);
    setData(null);
  }, [gene, preferredTissue]);

  useEffect(() => {
    if (!gene) return;
    setError("");
    api
      .expression(gene, tissue || preferredTissue)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [gene, tissue, preferredTissue]);

  const rows = data?.rows || [];
  const total = rows.reduce((sum, row) => sum + Number(row.TPM || 0), 0);
  const ids = rows.map((row) => row.Transcript);
  const shownTissue = data?.tissue || tissue || preferredTissue;
  const options = useMemo(() => {
    const names = [...(data?.tissues || [])];
    if (shownTissue && !names.includes(shownTissue)) names.unshift(shownTissue);
    if (preferredTissue && !names.includes(preferredTissue)) names.unshift(preferredTissue);
    return names;
  }, [data?.tissues, shownTissue, preferredTissue]);

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>Isoform expression</h3>
          <div className="sub">
            {gene} in {shownTissue}
          </div>
        </div>
        <div className="toolbar">
          <select value={shownTissue} onChange={(e) => setTissue(e.target.value)}>
            {options.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {geneAlias?.from ? (
        <p className="notice" style={{ paddingTop: 0 }}>
          {geneAlias.from} is not in the Gao sensor library, so this page uses{" "}
          <strong>{geneAlias.to}</strong>, the overlapping protein-coding gene.
        </p>
      ) : null}
      {error && <div className="error">{error}</div>}
      {!data && !error ? (
        <CuteLoad label={`Checking isoform expression for ${gene}…`} />
      ) : (
        <>
          <p className="notice" style={{ paddingTop: 0 }}>
            Dataset: long-read RNA-seq. Mean TPM from GTEx ({data?.sample_count || 0} samples).
            Relative abundance is among expressed isoforms for this gene.
            {fibro.gtexNote ? ` ${fibro.gtexNote}` : ""}
          </p>
          <div className="grid-2">
            <div>
              <div className="bar" style={{ height: 42, marginBottom: 18 }}>
                {rows.map((row, i) => (
                  <span
                    key={row.Transcript}
                    title={`${row.Transcript} ${Number(row["Rel. %"]).toFixed(1)}%`}
                    style={{ width: `${row["Rel. %"]}%`, background: COLORS[i % COLORS.length] }}
                  />
                ))}
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th></th>
                      <th>transcript</th>
                      <th>tpm</th>
                      <th>rel. %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={row.Transcript}>
                        <td>
                          <i className="swatch" style={{ background: COLORS[i % COLORS.length], display: "inline-block" }} />
                        </td>
                        <td className="mono">{row.Transcript}</td>
                        <td>{Number(row.TPM).toFixed(2)}</td>
                        <td>
                          <strong style={{ color: COLORS[i % COLORS.length] }}>
                            {Number(row["Rel. %"]).toFixed(1)}%
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data && !rows.length && (
                <div className="notice">No isoform with TPM &gt; 0 in {shownTissue}.</div>
              )}
            </div>
            <div className="drawer">
              <strong>Total expressed</strong>
              <div className="value" style={{ fontSize: 42, fontWeight: 800 }}>
                {total.toFixed(1)}
              </div>
              <div className="label">
                mean TPM · {rows.length} isoform{rows.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          {footer ? <div className="isoform-choice">{footer({ rows, ids })}</div> : null}
        </>
      )}
    </section>
  );
}
