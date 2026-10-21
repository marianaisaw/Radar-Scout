import { useGene } from "../gene-context.jsx";

export default function Overview({ onSearch, draft, setDraft }) {
  const { gene } = useGene();
  return (
    <>
      <section className="metrics">
        <div className="metric">
          <div className="bubble">♡</div>
          <div>
            <div className="label">Current gene</div>
            <div className="value">{gene || "—"}</div>
            <div className="delta">from the search box</div>
          </div>
        </div>
        <div className="metric">
          <div className="bubble">◎</div>
          <div>
            <div className="label">Long-read tissues</div>
            <div className="value">15</div>
            <div className="delta">GTEx ONT</div>
          </div>
        </div>
        <div className="metric">
          <div className="bubble">∿</div>
          <div>
            <div className="label">Folding engine</div>
            <div className="value">Vienna</div>
            <div className="delta">RNAplfold and RNAfold</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h3>RADAR-SCOUT</h3>
            <p className="sub">Enter a human gene, then use the tabs on the left.</p>
          </div>
        </div>
        <p style={{ color: "var(--muted)", maxWidth: 680, lineHeight: 1.55, marginTop: 0 }}>
          Gao Lab precomputed RADAR designs, filtered by isoforms present in a
          GTEx long-read cell type. Accessibility is RNAplfold on the mRNA;
          sensor structure is RNAfold on the sensor RNA only.
        </p>
        <form onSubmit={onSearch} style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ADAM12, POSTN, COL11A1"
            style={{ flex: 1, border: "1px solid var(--line)", borderRadius: 999, padding: "10px 14px" }}
          />
          <button className="btn" type="submit">Open candidates</button>
        </form>
      </section>
    </>
  );
}
