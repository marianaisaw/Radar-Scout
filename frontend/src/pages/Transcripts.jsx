import { useState } from "react";
import { api } from "../api.js";
import { useGene } from "../gene-context.jsx";

export default function Transcripts() {
  const { gene } = useGene();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await api.fasta(gene));
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
          <h3>Ensembl transcripts</h3>
          <div className="sub">cDNA FASTA for {gene}</div>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? "Fetching…" : "Get FASTA"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <>
          <section className="metrics" style={{ margin: "8px 0 18px" }}>
            <div className="metric">
              <div className="bubble">▤</div>
              <div>
                <div className="label">Transcripts</div>
                <div className="value">{data.n}</div>
              </div>
            </div>
            <div className="metric">
              <div className="bubble">nt</div>
              <div>
                <div className="label">Longest</div>
                <div className="value">
                  {Math.max(...data.transcripts.map((t) => t.length), 0)}
                </div>
              </div>
            </div>
            <div className="metric">
              <div className="bubble">ID</div>
              <div>
                <div className="label">Source</div>
                <div className="value" style={{ fontSize: 22 }}>Ensembl</div>
              </div>
            </div>
          </section>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Transcript</th>
                  <th>Biotype</th>
                  <th>Length</th>
                </tr>
              </thead>
              <tbody>
                {data.transcripts.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.id}</td>
                    <td>{row.biotype || "—"}</td>
                    <td>{row.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub">FASTA</p>
          <textarea className="fasta" readOnly value={data.fasta} />
          <p>
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                const blob = new Blob([data.fasta], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${gene}_transcripts.fasta`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download FASTA
            </button>
          </p>
        </>
      )}
    </section>
  );
}
