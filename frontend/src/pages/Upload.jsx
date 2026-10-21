import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { analyzeBulkZip, inspectBulkZip } from "../bulkZip.js";
import FlowChrome from "../FlowChrome.jsx";
import { fibrosisById } from "../diseases.js";
import { useGene } from "../gene-context.jsx";
import CuteLoad from "../CuteLoad.jsx";

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Upload() {
  const { disease } = useParams();
  const fibro = fibrosisById(disease);
  const navigate = useNavigate();
  const { setFibrosisId, setBulkCohort, setRankSource } = useGene();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");

  async function takeFile(next) {
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".zip")) {
      setFile(null);
      setPreview(null);
      setError("Upload a .zip of bulk RNA-seq results, for example ZXRTWC_results.zip.");
      return;
    }
    setFile(next);
    setPreview(null);
    setError("");
    setLoading(true);
    try {
      setPreview(await inspectBulkZip(next));
    } catch (err) {
      setPreview(null);
      setError(err.message || "Could not read that zip.");
    } finally {
      setLoading(false);
    }
  }

  function onFile(event) {
    takeFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event) {
    event.preventDefault();
    setOver(false);
    takeFile(event.dataTransfer.files?.[0]);
  }

  function toRanking() {
    setFibrosisId(fibro.id);
    setRankSource("public");
    navigate(`/ranking/${fibro.id}`);
  }

  async function runAnalysis() {
    if (!file) {
      setError("Upload a .zip first.");
      return;
    }
    setError("");
    setRunning(true);
    setFibrosisId(fibro.id);
    try {
      const cohort = await analyzeBulkZip(file, fibro.id);
      setBulkCohort(cohort);
      setRankSource("bulk");
      navigate(`/ranking/${fibro.id}`);
    } catch (err) {
      setError(err.message || "Could not rank that zip.");
      setRunning(false);
    }
  }

  if (running) {
    return (
      <FlowChrome step={2} disease={fibro.id} backFallback={`/source/${fibro.id}`}>
        <CuteLoad label={`Ranking genes from ${file?.name || "your zip"}…`} />
      </FlowChrome>
    );
  }

  return (
    <FlowChrome step={2} disease={fibro.id} backFallback={`/source/${fibro.id}`}>
      <section className="flow-main source-main">
        <p className="start-kicker">Bulk RNA-seq</p>
        <h1>Upload the results zip</h1>
        <p className="start-lead">
          Drop the pipeline zip. We score the expression matrix inside.
        </p>
        <div className="upload-panel">
          <label
            className={`upload-drop${over ? " on" : ""}${file ? " has" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <input type="file" accept=".zip,application/zip" onChange={onFile} />
            <strong>{file ? file.name : "Drop a .zip here, or browse"}</strong>
            <span>
              {file
                ? formatBytes(file.size)
                : "Needs an expression matrix inside, e.g. ZXRTWC-expression-matrix.tsv"}
            </span>
          </label>
          {loading ? <p className="notice" style={{ paddingTop: 0 }}>Opening the zip…</p> : null}
          {preview ? (
            <div className="upload-found">
              <p>
                Using <strong>{preview.matrix}</strong>
              </p>
              <p>
                {preview.genes.toLocaleString()} genes
                {preview.samples.length ? ` · ${preview.samples.length} libraries` : ""}
              </p>
              {preview.samples.length ? (
                <ul>
                  {preview.samples.map((sample) => (
                    <li key={sample}>{sample}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {error ? <div className="error">{error}</div> : null}
          <div className="toolbar">
            <button className="btn" type="button" disabled={!preview || loading} onClick={runAnalysis}>
              Run RADAR analysis
            </button>
            <button className="btn ghost" type="button" onClick={toRanking}>
              Public ranking
            </button>
          </div>
        </div>
      </section>
    </FlowChrome>
  );
}
