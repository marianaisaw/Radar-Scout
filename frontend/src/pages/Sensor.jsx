import { useState } from "react";
import { api } from "../api.js";
import { loadSaved } from "../saved.js";
import FornaView, { findPrimaryUag } from "../FornaView.jsx";

export default function Sensor() {
  const [sequence, setSequence] = useState("");
  const [result, setResult] = useState(null);
  const [foldedFrom, setFoldedFrom] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const saved = loadSaved().filter((row) => row.sensor);
  const codon = result ? findPrimaryUag(foldedFrom || result.sequence) : null;

  async function run() {
    setLoading(true);
    setError("");
    try {
      setFoldedFrom(sequence);
      setResult(await api.sensor(sequence));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>Sensor structure</h3>
          <div className="sub">RNAfold ensemble · sensor RNA only</div>
        </div>
        <button className="btn" onClick={run} disabled={loading}>
          {loading ? "Folding…" : "Fold sensor"}
        </button>
      </div>
      <label className="field">
        <span>Sensor sequence</span>
        <textarea className="fasta" value={sequence} onChange={(e) => setSequence(e.target.value)} />
      </label>
      {saved.length > 0 && (
        <div className="drawer" style={{ marginBottom: 16 }}>
          <strong>Use a saved candidate’s sensor</strong>
          <div className="chips" style={{ marginTop: 10 }}>
            {saved.map((row) => (
              <button
                key={row.id}
                className="chip"
                type="button"
                onClick={() => setSequence(row.sensor || "")}
              >
                {row.gene || "gene"} · {row.variant} · {row.length} nt
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {result && (
        <>
          <div className="metrics">
            <div className="metric">
              <div className="bubble">ΔG</div>
              <div>
                <div className="label">MFE ΔG</div>
                <div className="value" style={{ fontSize: 28 }}>{result.mfe_kcal.toFixed(2)}</div>
                <div className="delta">kcal/mol</div>
              </div>
            </div>
            <div className="metric">
              <div className="bubble">E</div>
              <div>
                <div className="label">Ensemble free energy</div>
                <div className="value" style={{ fontSize: 28 }}>
                  {result.ensemble_energy_kcal.toFixed(2)}
                </div>
                <div className="delta">kcal/mol</div>
              </div>
            </div>
            <div className="metric">
              <div className="bubble">%</div>
              <div>
                <div className="label">MFE frequency</div>
                <div className="value" style={{ fontSize: 28 }}>
                  {(result.mfe_frequency * 100).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="metric">
              <div className="bubble">σ</div>
              <div>
                <div className="label">Diversity</div>
                <div className="value" style={{ fontSize: 28 }}>
                  {result.ensemble_diversity.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
          <p className="notice" style={{ paddingTop: 0 }}>
            RNAfold −p with avoid isolated base pairs (--noLP)
            {result.version ? ` · ${result.version}` : ""}
          </p>
          <h4 className="fold-heading">MFE structure</h4>
          <pre className="fold-code">{`${result.sequence}\n${result.mfe_structure}`}</pre>
          <FornaView result={result} rawSequence={foldedFrom} />
          <p className="notice">
            FORNA force-directed drawing of the MFE structure. Drag nucleotides to
            rearrange; scroll to zoom. Colored like the RNAfold web server: red
            means the MFE assignment is likely, blue means it is uncertain.
            {codon
              ? ` The UAG codon of interest (nt ${codon.start}–${codon.end}${
                  codon.marked ? ", Gao edit site" : ""
                }) is marked with a black ring.`
              : ""}
          </p>
        </>
      )}
    </section>
  );
}
