const DELIVERY = new Set(["lipoplex", "lnp", "polyplex", "naked"]);
const SYSTEM = new Set(["plasmid", "mrna"]);
const LOGIC = new Set(["single", "and"]);
const DELIVERY_SCALE = { lipoplex: 1, lnp: 1.15, polyplex: 0.85, naked: 0.22 };

function linspace(t0, t1, n) {
  if (n < 2) return [t0];
  const step = (t1 - t0) / (n - 1);
  return Array.from({ length: n }, (_, i) => t0 + i * step);
}

function sigmoid(t, tHalf, steep, ymax, ymin = 0) {
  return ymin + (ymax - ymin) / (1 + Math.exp(-steep * (t - tHalf)));
}

function halfTime(system, t1) {
  if (system === "plasmid") return Math.min(22, 0.35 * t1);
  return Math.min(12, 0.22 * t1);
}

export function simulateLocal(payload) {
  const delivery = String(payload?.delivery || "");
  const system = String(payload?.system || "");
  const logic = String(payload?.logic || "");
  const allowed = { delivery: DELIVERY, system: SYSTEM, logic: LOGIC };
  for (const key of Object.keys(allowed)) {
    const value = String(payload?.[key] || "");
    if (!allowed[key].has(value)) {
      throw new Error(`${key} must be one of ${[...allowed[key]].sort().join(", ")}.`);
    }
  }

  const span = payload.tSpan || {};
  const t0 = Number(span.t0 ?? 0);
  const t1 = Number(span.t1 ?? 72);
  const n = Number(span.n ?? 145);
  const t = linspace(t0, t1, n);

  let scale = DELIVERY_SCALE[delivery] ?? 1;
  if (logic === "and") scale *= 0.72;

  const tHalf = halfTime(system, t1);
  const peak = scale;
  const leakAmp = 0.045 * scale;
  const onCurve = t.map((x) => sigmoid(x, tHalf, 0.28, peak, 0.01 * scale));
  const offCurve = t.map((x) => sigmoid(x, tHalf + 6, 0.18, leakAmp, 0.008 * scale));
  const peakOn = Math.max(...onCurve);
  const peakOff = Math.max(...offCurve);
  const half = peakOn / 2;
  let tHalfObs = t[t.length - 1];
  for (let i = 0; i < t.length; i += 1) {
    if (onCurve[i] >= half) {
      tHalfObs = t[i];
      break;
    }
  }

  const states = {
    output_on: onCurve,
    output_off: offCurve,
    cargo_extra: t.map((x) => Math.max(0, Math.exp(-0.08 * x))),
    endosome: t.map((x) => sigmoid(x, 4, 0.6, 0.35 * scale) * Math.exp(-0.04 * Math.max(0, x - 8))),
    sensor_rna: t.map((x) => sigmoid(x, tHalf - 4, 0.3, 0.8 * scale)),
  };
  if (system === "plasmid") {
    states.cytosol_dna = t.map((x) => sigmoid(x, 6, 0.4, 0.5 * scale) * Math.exp(-0.02 * x));
    states.nucleus = t.map((x) => sigmoid(x, 12, 0.35, 0.4 * scale));
  }

  const response = {
    t,
    states,
    observables: {
      foldChange: Number((peakOn / Math.max(peakOff, 1e-9)).toFixed(4)),
      leak: Number((peakOff / Math.max(peakOn, 1e-9)).toFixed(4)),
      tHalf: Number(tHalfObs.toFixed(3)),
      peakOutput: Number(peakOn.toFixed(4)),
    },
    stub: true,
    marker: "SIMULATION_STUB",
  };
  if (logic === "and") {
    const low = peakOff;
    const mid = peakOff + 0.12 * (peakOn - peakOff);
    response.truthTable = [
      { inputs: "00", output: Number(low.toFixed(4)) },
      { inputs: "01", output: Number(mid.toFixed(4)) },
      { inputs: "10", output: Number(mid.toFixed(4)) },
      { inputs: "11", output: Number(peakOn.toFixed(4)) },
    ];
  }
  return response;
}
