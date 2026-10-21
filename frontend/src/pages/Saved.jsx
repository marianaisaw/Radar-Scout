import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadSaved, storeSaved } from "../saved.js";
import { CANDIDATE_COLUMNS, cellClass, formatCell } from "../columns.js";
import { useGene } from "../gene-context.jsx";

export default function Saved() {
  const navigate = useNavigate();
  const { setPlaygroundCandidate } = useGene();
  const [rows, setRows] = useState(loadSaved);

  function clearAll() {
    storeSaved([]);
    setRows([]);
  }

  function remove(id) {
    const next = rows.filter((row) => row.id !== id);
    storeSaved(next);
    setRows(next);
  }

  function download() {
    const header = CANDIDATE_COLUMNS;
    const csv = [
      header.join(","),
      ...rows.map((row) => header.map((key) => JSON.stringify(row[key] ?? "")).join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "radar_saved_candidates.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function run() {
    setPlaygroundCandidate(null);
    navigate("/playground");
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>Saved candidates</h3>
          <div className="sub">{rows.length} designs in this browser</div>
        </div>
        <div className="toolbar">
          <button className="btn" type="button" onClick={run} disabled={!rows.length}>
            Run
          </button>
          <button className="btn ghost" onClick={download}>Download CSV</button>
          <button className="btn danger" onClick={clearAll}>Clear</button>
        </div>
      </div>
      {!rows.length && (
        <div className="notice">Save rows from Candidates, then Run to open the playground.</div>
      )}
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
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <button className="pill off" onClick={() => remove(row.id)}>Remove</button>
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
    </section>
  );
}
