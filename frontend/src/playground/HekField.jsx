import { useEffect, useMemo, useRef, useState } from "react";
import { FIELD_CELLS, buildMonolayer, paintField } from "./hekField.js";

function valueAt(times, series, hour) {
  if (!times?.length || !series?.length) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < times.length; i += 1) {
    const d = Math.abs(times[i] - hour);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return Number(series[best] || 0);
}

export default function HekField({ cell, conditions, result }) {
  const canvasRef = useRef(null);
  const harvest = Array.isArray(conditions.harvest_h) && conditions.harvest_h.length ? conditions.harvest_h[0] : 24;
  const tMax = result?.t?.length ? result.t[result.t.length - 1] : 72;
  const [hour, setHour] = useState(harvest);
  const [trigger, setTrigger] = useState("on");

  useEffect(() => {
    setHour(harvest);
  }, [harvest]);

  const tx = Math.max(0, Math.min(1, Number(cell?.transfection_efficiency ?? 0.7)));
  const field = useMemo(
    () =>
      buildMonolayer({
        seed: 12,
        transfectedFraction: tx,
      }),
    [tx],
  );

  const onNow = valueAt(result?.t, result?.states?.output_on, hour);
  const offNow = valueAt(result?.t, result?.states?.output_off, hour);
  const peak = Math.max(0.08, ...(result?.states?.output_on || [1]));
  const intensity = (trigger === "on" ? onNow : offNow) / peak;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !field) return;
    canvas.width = field.width;
    canvas.height = field.height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    paintField(ctx, field, { intensity });
  }, [field, intensity]);

  const label = cell?.label || "HEK293";
  const pct = Math.round(tx * 100);

  return (
    <div className="pg-field">
      <div className="pg-field-head">
        <div>
          <h3>GFP</h3>
          <p className="sub">
            {label} · {field.nGfp}/{FIELD_CELLS} · {pct}%
          </p>
        </div>
        <div className="pg-field-toggles">
          <button type="button" className={`chip${trigger === "on" ? " on" : ""}`} onClick={() => setTrigger("on")}>
            ON
          </button>
          <button type="button" className={`chip${trigger === "off" ? " on" : ""}`} onClick={() => setTrigger("off")}>
            OFF
          </button>
        </div>
      </div>
      <div className="pg-field-well">
        <canvas ref={canvasRef} className="pg-field-canvas" aria-label={`${label} GFP transfection field`} />
        <label className="pg-field-scrub">
          <span>{hour} h</span>
          <input
            type="range"
            min={0}
            max={tMax}
            step={1}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
