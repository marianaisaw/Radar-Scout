import { useEffect, useMemo } from "react";

const HEIGHT = 540;

function hsbToHex(h, s, v) {
  const hue = ((h % 1) + 1) % 1;
  const i = Math.floor(hue * 6);
  const f = hue * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  const hex = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function probabilityToHex(p) {
  const clamped = Math.min(1, Math.max(0, Number(p) || 0));
  return hsbToHex(0.8 * (1 - clamped), 1, 1);
}

function mfeStateProbabilities(structure, pairing, mfePair) {
  return [...structure].map((ch, i) => {
    if (ch === "(" || ch === ")") return Number(mfePair?.[i] ?? 0);
    return 1 - Number(pairing?.[i] ?? 0);
  });
}

export function findPrimaryUag(raw) {
  const compact = String(raw || "").replace(/\s+/g, "");
  if (compact.length < 3) return null;
  const rna = compact.toUpperCase().replace(/T/g, "U");
  const markedA = new Set();
  for (let i = 1; i < compact.length - 1; i += 1) {
    if (compact[i] !== "a") continue;
    const left = compact[i - 1].toUpperCase().replace("T", "U");
    const right = compact[i + 1].toUpperCase().replace("T", "U");
    if (left === "U" && right === "G") markedA.add(i);
  }
  const hits = [];
  for (let i = 0; i <= rna.length - 3; i += 1) {
    if (rna.slice(i, i + 3) !== "UAG") continue;
    hits.push({
      start: i + 1,
      end: i + 3,
      marked: markedA.has(i + 1),
      inFrame: i % 3 === 0,
    });
  }
  hits.sort(
    (a, b) =>
      Number(!a.marked) - Number(!b.marked) ||
      Number(!a.inFrame) - Number(!b.inFrame) ||
      a.start - b.start
  );
  return hits[0] || null;
}

function fornaHtml(result, codon) {
  const origin = window.location.origin;
  const sequence = [...result.sequence.toUpperCase()].filter((ch) => "ACGTU".includes(ch)).join("");
  const structure = [...result.mfe_structure].filter((ch) => ".()".includes(ch)).join("");
  const n = Math.min(
    sequence.length,
    structure.length,
    result.pairing_probability?.length || 0
  );
  const seq = sequence.slice(0, n);
  const db = structure.slice(0, n);
  const probs = mfeStateProbabilities(
    db,
    result.pairing_probability,
    result.mfe_pair_probability || result.pairing_probability
  ).slice(0, n);
  const hexes = Object.fromEntries(probs.map((p, i) => [String(i + 1), probabilityToHex(p)]));
  const payload = {
    sequence: seq,
    structure: db,
    name: "sensor",
    codonStart: codon?.start || null,
    codonEnd: codon?.end || null,
    customColors: {
      domain: [0, 1],
      range: ["#0000ff", "#ff0000"],
      colorValues: { sensor: hexes, "": hexes },
    },
  };
  const data = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<meta charset="utf-8">
<link rel="stylesheet" href="${origin}/vendor/fornac.css" />
<style>
  html, body { margin: 0; padding: 0; background: #fff; font-family: inherit, sans-serif; }
  #rna_ss {
    width: 100%;
    height: ${HEIGHT}px;
    border: 1px solid #e6e9ef;
    border-radius: 8px;
    overflow: hidden;
  }
  #rna_ss svg { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; }
  .forna-legend {
    display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: #445;
  }
  .forna-legend .bar {
    flex: 1; height: 10px; border-radius: 4px;
    background: linear-gradient(90deg, hsl(288,100%,50%) 0%, hsl(216,100%,50%) 25%, hsl(144,100%,50%) 50%, hsl(72,100%,50%) 75%, hsl(0,100%,50%) 100%);
  }
  #forna-error { color: #b42318; font-size: 13px; min-height: 1em; }
  .forna-codon-note { margin-top: 4px; font-size: 12px; color: #445; }
  g.gnode.uag-codon circle.outline_node {
    visibility: visible !important; fill: none !important; stroke: #111 !important; stroke-width: 3.5px !important;
  }
</style>
<div id="rna_ss"></div>
<div class="forna-legend"><span>0 uncertain</span><div class="bar"></div><span>1 likely</span></div>
<div class="forna-codon-note" id="forna-codon-note"></div>
<div id="forna-error"></div>
<script type="application/json" id="forna-data">${data}</script>
<script src="${origin}/vendor/fornac.js"></script>
<script>
(function () {
  var err = document.getElementById("forna-error");
  try {
    var data = JSON.parse(document.getElementById("forna-data").textContent);
    var Forna = (window.fornac && window.fornac.FornaContainer) || window.FornaContainer;
    if (!Forna) throw new Error("FORNA library did not load.");
    var wrap = document.getElementById("rna_ss");
    var w = Math.max(320, wrap.clientWidth || 640);
    var container = new Forna("#rna_ss", {
      applyForce: true,
      allowPanningAndZooming: true,
      initialSize: [w, ${HEIGHT}]
    });
    container.addRNA(data.structure, {
      sequence: data.sequence,
      name: data.name,
      labelInterval: 10
    });
    container.addCustomColors(data.customColors);
    container.changeColorScheme("custom");
    if (container.setSize) container.setSize();
    if (container.centerView) container.centerView();
    function markCodon() {
      var start = data.codonStart;
      var end = data.codonEnd;
      var note = document.getElementById("forna-codon-note");
      if (!start || !end) { if (note) note.textContent = ""; return; }
      if (note) note.textContent = "Black ring = UAG codon of interest (nt " + start + "–" + end + ").";
      for (var i = start; i <= end; i++) {
        var g = wrap.querySelector('g.gnode[num="n' + i + '"]');
        if (g) g.classList.add("uag-codon");
      }
    }
    markCodon();
    setTimeout(markCodon, 250);
    setTimeout(markCodon, 800);
  } catch (e) {
    err.textContent = "FORNA could not draw this structure: " + e.message;
  }
})();
</script>`;
}

export default function FornaView({ result, rawSequence }) {
  const codon = useMemo(() => findPrimaryUag(rawSequence || result.sequence), [rawSequence, result.sequence]);
  const html = useMemo(() => fornaHtml(result, codon), [result, codon]);
  const src = useMemo(() => URL.createObjectURL(new Blob([html], { type: "text/html" })), [html]);

  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  return (
    <iframe
      className="forna-frame"
      title="MFE secondary structure"
      src={src}
    />
  );
}
