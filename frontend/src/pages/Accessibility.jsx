import { useState } from "react";
import { api } from "../api.js";
import { loadSaved } from "../saved.js";
import { CANDIDATE_COLUMNS, cellClass, formatCell } from "../columns.js";

function Spark({ values, highlight }) {
  if (!values?.length) return null;
  const w = 640;
  const h = 150;
  const nums = values.map((v) => (v == null ? 0 : v));
  const max = Math.max(...nums, 1);
  const pts = nums
    .map((v, i) => `${(i / (nums.length - 1)) * w},${h - (v / max) * (h - 12) - 6}`)
    .join(" ");
  return (
    <svg className="profile" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline fill="none" stroke="#e11d2a" strokeWidth="2.8" strokeLinejoin="round" points={pts} />
      {highlight && (
        <rect
          x={(highlight[0] / nums.length) * w}
          width={Math.max(2, ((highlight[1] - highlight[0]) / nums.length) * w)}
          y="0"
          height={h}
          fill="rgba(37, 99, 235, 0.14)"
        />
      )}
    </svg>
  );
}

export default function Accessibility() {
  const [mode, setMode] = useState("full");
  const [fasta, setFasta] = useState("");
  const [candidate, setCandidate] = useState("");
  const [fragment, setFragment] = useState("");
  const [codon, setCodon] = useState("UAG");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [w, setW] = useState(200);
  const [l, setL] = useState(150);
  const [u, setU] = useState(20);
  const saved = loadSaved();

  async function run() {
    setLoading(true);
    setError("");
    try {
      if (mode === "full") {
        setResult(await api.accessibility({ sequence: fasta, candidate, w, l, u }));
      } else {
        setResult(await api.fragment({ fragment, codon, u }));
      }
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>Endogenous accessibility</h3>
          <div className="sub">RNAplfold unpaired probability</div>
        </div>
        <div className="toolbar">
          <button className={mode === "full" ? "btn" : "btn ghost"} onClick={() => setMode("full")}>
            Full transcript
          </button>
          <button className={mode === "frag" ? "btn" : "btn ghost"} onClick={() => setMode("frag")}>
            Trigger only
          </button>
        </div>
      </div>
      {mode === "full" ? (
        <>
        <div className="grid-2">
          <label className="field">
            <span>Transcript FASTA</span>
            <textarea className="fasta" value={fasta} onChange={(e) => setFasta(e.target.value)} placeholder=">ENST..." />
            <input
              type="file"
              accept=".fa,.fasta,.txt,.fna"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setFasta(await file.text());
              }}
            />
          </label>
          <label className="field">
            <span>Candidate / trigger</span>
            <textarea className="fasta" value={candidate} onChange={(e) => setCandidate(e.target.value)} />
          </label>
        </div>
        {saved.length > 0 && (
          <div className="drawer">
            <strong>Choose a saved RADAR candidate</strong>
            <p className="sub">Uses the candidate column, not the sensor.</p>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th></th>
                    {CANDIDATE_COLUMNS.map((key) => (
                      <th key={key}>{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {saved.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button className="btn ghost" type="button" onClick={() => setCandidate(row.candidate || "")}>
                          Use
                        </button>
                      </td>
                      {CANDIDATE_COLUMNS.map((key) => (
                        <td key={key} className={cellClass(key)}>
                          {formatCell(key, row[key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </>
      ) : (
        <div className="grid-2">
          <label className="field">
            <span>Trigger fragment</span>
            <textarea className="fasta" value={fragment} onChange={(e) => setFragment(e.target.value)} />
          </label>
          <label className="field">
            <span>Variant codon</span>
            <input value={codon} onChange={(e) => setCodon(e.target.value)} />
          </label>
        </div>
      )}
      <div className="filters" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <label className="field">
          <span>Window size W</span>
          <input type="number" min="1" value={w} onChange={(e) => setW(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Max pair span L</span>
          <input type="number" min="1" value={l} onChange={(e) => setL(Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Unpaired length u</span>
          <input type="number" min="1" value={u} onChange={(e) => setU(Number(e.target.value))} />
        </label>
      </div>
      <p>
        <button className="btn" onClick={run} disabled={loading}>
          {loading ? "Folding…" : "Run RNAplfold"}
        </button>
      </p>
      {error && <div className="error">{error}</div>}
      {result?.summary && (
        <>
          <div className="metrics">
            <div className="metric">
              <div className="bubble">μ</div>
              <div>
                <div className="label">Mean unpaired</div>
                <div className="value">{result.summary.mean_unpaired_l1.toFixed(2)}</div>
              </div>
            </div>
            <div className="metric">
              <div className="bubble">max</div>
              <div>
                <div className="label">Max unpaired</div>
                <div className="value">{result.summary.max_unpaired_l1.toFixed(2)}</div>
              </div>
            </div>
            <div className="metric">
              <div className="bubble">nt</div>
              <div>
                <div className="label">Site</div>
                <div className="value" style={{ fontSize: 22 }}>
                  {result.match.start}–{result.match.end}
                </div>
              </div>
            </div>
          </div>
          <Spark
            values={result.profile}
            highlight={
              result.match && result.transcript_length
                ? [
                    (result.match.start / result.transcript_length) * result.profile.length,
                    (result.match.end / result.transcript_length) * result.profile.length,
                  ]
                : null
            }
          />
          {result.windows && (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Window</th>
                    <th>Position</th>
                    <th>Unpaired</th>
                    <th>Sequence</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(result.windows).map(([size, win]) =>
                    win ? (
                      <tr key={size}>
                        <td>{size} nt</td>
                        <td>
                          {win.start}–{win.end}
                        </td>
                        <td>{Number(win.probability).toFixed(3)}</td>
                        <td className="mono clip" title={win.sequence}>
                          {win.sequence}
                        </td>
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {result?.exposure && (
        <div className="drawer">
          Codon unpaired {Number(result.exposure.codon_mean_l1 || 0).toFixed(2)} · window{" "}
          {Number(result.exposure.window_mean_l1 || 0).toFixed(2)}
          <Spark values={result.profile} />
        </div>
      )}
    </section>
  );
}
