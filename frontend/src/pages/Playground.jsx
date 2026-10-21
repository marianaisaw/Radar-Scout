import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api.js";
import { loadSaved } from "../saved.js";
import { CANDIDATE_COLUMNS, cellClass, formatCell } from "../columns.js";
import { useGene } from "../gene-context.jsx";
import FlowChrome from "../FlowChrome.jsx";
import CuteLoad from "../CuteLoad.jsx";
import ChartCard from "../scout/components/ChartCard.jsx";
import { COLORS } from "../scout/lib/utils.js";
import ConditionsPanel from "../playground/ConditionsPanel.jsx";
import ParamSliders from "../playground/ParamSliders.jsx";
import HekField from "../playground/HekField.jsx";
import {
  CELL_TYPES,
  PRESETS,
  buildRequest,
  defaultCellType,
  defaultConditions,
  defaultParams,
  matchingPreset,
  optionBlocked,
  summaryLine,
} from "../playground/schema.js";
import "../scout/scout.css";

const PIN_COLORS = ["#7c5cbf", "#2563eb", "#c01020", "#0f766e"];
const RAIL_COMPACT = 280;
const RAIL_WIDE = 460;
const RAIL_MIN = 240;
const RAIL_MAX = 640;

function clampRail(width) {
  const cap = Math.min(RAIL_MAX, Math.round((typeof window === "undefined" ? 1200 : window.innerWidth) * 0.55));
  return Math.min(cap, Math.max(RAIL_MIN, Math.round(width)));
}

function packCandidate(row) {
  return {
    id: row.id,
    gene: row.gene,
    gene_id: row.gene_id,
    variant: row.variant,
    length: row.length,
    region_type: row.region_type,
    sensor: row.sensor,
    transcript_ids: row.transcript_ids,
  };
}

export default function Playground() {
  const { fibrosisId, playgroundModel, setPlaygroundModel, playgroundCandidate, setPlaygroundCandidate } = useGene();
  const model = playgroundModel;
  const saved = loadSaved();
  const attached = Array.isArray(playgroundCandidate)
    ? playgroundCandidate
    : playgroundCandidate
      ? [playgroundCandidate]
      : [];
  const preset = matchingPreset(model);
  const need = model.logic === "and" ? 2 : 1;
  const ready = attached.length === need;
  const pickKey = attached.map((row) => row.id).join(",");

  const [params, setParams] = useState(() => defaultParams(model));
  const [overrides, setOverrides] = useState(() => new Set());
  const [conditions, setConditions] = useState(() => {
    const base = defaultConditions(model);
    return { ...base, cell_type: defaultCellType(fibrosisId) };
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState([]);
  const [hiddenPins, setHiddenPins] = useState(() => new Set());
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [railWidth, setRailWidth] = useState(RAIL_COMPACT);
  const [railResizing, setRailResizing] = useState(false);
  const railDrag = useRef(null);

  function applyModel(next) {
    if (optionBlocked("delivery", next.delivery, next) || optionBlocked("system", next.system, next)) return;
    setPlaygroundModel(next);
    const fresh = defaultParams(next);
    setParams((prev) => {
      const merged = { ...fresh };
      for (const name of overrides) {
        if (prev[name] != null) merged[name] = prev[name];
      }
      return merged;
    });
    setConditions((prev) => ({ ...defaultConditions(next), ...prev }));
    if (next.logic === "single" && attached.length > 1) {
      setPlaygroundCandidate(attached[0]);
    }
  }

  function pickSaved(row) {
    const payload = packCandidate(row);
    if (need === 1) {
      setPlaygroundCandidate(attached[0]?.id === payload.id ? null : payload);
      return;
    }
    const without = attached.filter((item) => item.id !== payload.id);
    const next = without.length === attached.length ? [...attached, payload].slice(-2) : without;
    setPlaygroundCandidate(next);
  }

  function setParam(name, value) {
    setOverrides((current) => new Set(current).add(name));
    setParams((prev) => ({ ...prev, [name]: value }));
  }

  function revertParam(name, value) {
    setOverrides((current) => {
      const next = new Set(current);
      next.delete(name);
      return next;
    });
    setParams((prev) => ({ ...prev, [name]: value }));
  }

  useEffect(() => {
    if (!ready) {
      setResult(null);
      setLoading(false);
      setError("");
      return;
    }
    const handle = setTimeout(() => {
      setLoading(true);
      setError("");
      api
        .simulate(buildRequest(model, conditions, params))
        .then((data) => setResult(data))
        .catch((err) => setError(err.message || "Simulation failed."))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(handle);
  }, [model, conditions, params, ready, pickKey]);

  const series = useMemo(() => {
    if (!result?.t) return [];
    const on = result.states?.output_on || [];
    const off = result.states?.output_off || [];
    return result.t.map((t, i) => {
      const row = { t, on: on[i], off: off[i] };
      pinned.forEach((run, index) => {
        row[`pinOn${index}`] = run.on[i];
        row[`pinOff${index}`] = run.off[i];
      });
      return row;
    });
  }, [result, pinned]);

  function pinCurrent() {
    if (!result?.t) return;
    const cell = CELL_TYPES.find((row) => row.id === conditions.cell_type);
    const label = `${summaryLine(model)} · ${cell?.label || conditions.cell_type} · ${conditions.dose}${conditions.dose_unit}`;
    setPinned((rows) => [
      ...rows,
      {
        id: `${Date.now()}`,
        label,
        on: result.states.output_on,
        off: result.states.output_off,
      },
    ]);
  }

  function toggleSetup() {
    setSetupExpanded((open) => {
      const next = !open;
      setRailWidth(next ? RAIL_WIDE : RAIL_COMPACT);
      return next;
    });
  }

  function startRailResize(event) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    railDrag.current = { startX: event.clientX, startWidth: railWidth };
    setRailResizing(true);

    function onMove(moveEvent) {
      const drag = railDrag.current;
      if (!drag) return;
      const next = clampRail(drag.startWidth + moveEvent.clientX - drag.startX);
      setRailWidth(next);
      setSetupExpanded(next >= (RAIL_COMPACT + RAIL_WIDE) / 2);
    }

    function onUp() {
      railDrag.current = null;
      setRailResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function togglePin(id) {
    setHiddenPins((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    if (!result?.t) return;
    const cell = CELL_TYPES.find((row) => row.id === conditions.cell_type);
    const gene = attached.map((row) => row.gene).join("+") || "run";
    const filename = `radar_${gene}_${model.delivery}_${model.system}_${model.logic}_${cell?.label || "cell"}_${conditions.dose}${conditions.dose_unit}.csv`;
    const lines = [
      `# ${summaryLine(model)}`,
      `# cell=${cell?.label || conditions.cell_type} dose=${conditions.dose}${conditions.dose_unit} well=${conditions.well_format} ratio=${conditions.carrier_ratio} serum=${conditions.serum ? "yes" : "no"}`,
      `# gene=${gene} harvest=${(conditions.harvest_h || []).join("/")}h`,
      "t_h,output_on,output_off",
      ...result.t.map((t, i) => `${t},${result.states.output_on[i]},${result.states.output_off[i]}`),
    ];
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <FlowChrome
      step={5}
      disease={fibrosisId}
      wide
      backFallback="/design/saved"
    >
      <div className="kyle-dash ranking-page playground-page">
        <div className="topbar ranking-topbar">
          <div className="hello">
            <h2>Playground</h2>
            <div className="rank-source" role="tablist" aria-label="Model">
              {PRESETS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`chip${preset?.id === row.id ? " on" : ""}`}
                  onClick={() =>
                    applyModel({
                      delivery: row.delivery,
                      system: row.system,
                      logic: row.logic,
                    })
                  }
                >
                  {row.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pg-pick">
          <p className="pg-kicker">
            {need === 2
              ? `AND gate · pick two sensors${attached.length ? ` · ${attached.length} of 2` : ""}`
              : "Single trigger · pick one sensor"}
          </p>
          {saved.length ? (
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
                  {saved.map((row) => {
                    const selected = attached.some((item) => item.id === row.id);
                    const mark =
                      need === 2 && selected
                        ? attached[0]?.id === row.id
                          ? "A"
                          : "B"
                        : "Select";
                    return (
                      <tr key={row.id}>
                        <td>
                          <button
                            type="button"
                            className={selected ? "pill on" : "btn"}
                            onClick={() => pickSaved(row)}
                          >
                            {selected && need === 1 ? "Selected" : mark}
                          </button>
                        </td>
                        {CANDIDATE_COLUMNS.map((key) => (
                          <td key={key} className={cellClass(key)}>
                            {formatCell(key, row[key])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="pg-derived">Save a candidate first, then pick it here.</p>
          )}
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div
          className={`ranking-workspace${setupExpanded ? " is-setup-expanded" : ""}${railResizing ? " is-rail-resizing" : ""}`}
          style={{ "--pg-rail": `${railWidth}px` }}
        >
          <aside className="card workspace-ranks">
            <div className="card-head pg-setup-head">
              <h3>Run setup</h3>
              <button
                type="button"
                className={`chip${setupExpanded ? " on" : ""}`}
                onClick={toggleSetup}
                aria-expanded={setupExpanded}
              >
                {setupExpanded ? "Collapse" : "Expand"}
              </button>
              <div className="sub">{summaryLine(model)}</div>
            </div>
            <ConditionsPanel model={model} conditions={conditions} onChange={setConditions} />
            <ParamSliders model={model} params={params} onChange={setParam} onRevert={revertParam} />
            <div
              className="pg-rail-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize run setup"
              title="Drag to resize"
              onPointerDown={startRailResize}
              onDoubleClick={() => {
                setRailWidth(setupExpanded ? RAIL_WIDE : RAIL_COMPACT);
              }}
            />
          </aside>

          <section className="card workspace-detail">
            {!ready ? (
              <div className="notice">
                {need === 2
                  ? attached.length === 1
                    ? "AND gate needs two sensors. Pick a second saved candidate."
                    : saved.length < 2
                      ? "AND gate needs two saved sensors. Save another candidate first."
                      : "AND gate needs two sensors. Pick both from the list above."
                  : saved.length
                    ? "Pick a saved candidate to run a single-trigger simulation."
                    : "Save a candidate first, then pick it to run."}
              </div>
            ) : loading && !result ? (
              <CuteLoad label="Simulating…" />
            ) : (
              <>
                <div className="pg-stage">
                  <HekField
                    cell={CELL_TYPES.find((row) => row.id === "hek293")}
                    conditions={conditions}
                    result={result}
                  />
                  <ChartCard
                    title="Output protein"
                    sub="ON vs OFF"
                    filename={`radar_${attached[0]?.gene || "run"}_timecourse`}
                    legend={
                      <>
                        <span className="swatch" style={{ background: COLORS.crimson }} /> ON
                        <span className="swatch" style={{ background: COLORS.teal, marginLeft: 10 }} /> OFF
                      </>
                    }
                  >
                    <ResponsiveContainer width="100%" height={268}>
                      <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                        <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
                        <XAxis dataKey="t" type="number" tick={{ fontSize: 11 }} label={{ value: "h", position: "insideBottomRight", offset: -2, fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="on" name="ON" stroke={COLORS.crimson} dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="off" name="OFF" stroke={COLORS.teal} dot={false} strokeWidth={2} />
                        {pinned.map((run, index) =>
                          hiddenPins.has(run.id) ? null : (
                            <Line
                              key={run.id}
                              type="monotone"
                              dataKey={`pinOn${index}`}
                              name={run.label}
                              stroke={PIN_COLORS[index % PIN_COLORS.length]}
                              dot={false}
                              strokeDasharray="5 4"
                              strokeWidth={1.6}
                            />
                          )
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartCard>
                </div>

                {model.logic === "and" && result?.truthTable ? (
                  <ChartCard title="AND truth table" sub="00 / 01 / 10 / 11" filename={`radar_${attached[0]?.gene || "run"}_and`}>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={result.truthTable} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
                        <XAxis dataKey="inputs" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="output" fill={COLORS.teal} radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>
                ) : null}
              </>
            )}
          </section>
        </div>

        <div className="pg-tray">
          <button type="button" className="chip" onClick={pinCurrent} disabled={!ready || !result}>
            Pin this run
          </button>
          {pinned.map((run) => (
            <button
              key={run.id}
              type="button"
              className={`chip${hiddenPins.has(run.id) ? "" : " on"}`}
              onClick={() => togglePin(run.id)}
            >
              {run.label}
            </button>
          ))}
          <button type="button" className="chip" onClick={exportCsv} disabled={!ready || !result}>
            Export CSV
          </button>
        </div>
      </div>
    </FlowChrome>
  );
}
