// Shared helpers: brand colors, formatting, CSV export, chart-SVG/PNG download.

export const COLORS = {
  crimson: '#8e1918',
  crimsonSoft: '#b45150',
  teal: '#1c7170',
  tealSoft: '#5aa3a2',
  tealFaint: '#e6f3f3',
  ink: '#1a2332',
  muted: '#5c6b7f',
  border: '#c5ced9',
  borderStrong: '#a8b4c4',
}

// Component fields shown across list / filters / compare.
export const COMPONENTS = [
  { key: 'RACS', label: 'RACS' },
  { key: 'Sep', label: 'Sep' },
  { key: 'Feas', label: 'Feas' },
  { key: 'Repro', label: 'Repro' },
  { key: 'OffMax', label: 'OffMax' },
]

// The ways a target can be ranked. Each carries the exact formula it computes and a
// plain-language reading of every term, so the ranking is never a black box.
// `scale` describes what the displayed number actually means.
export const RANK_METRICS = {
  spec_score: {
    key: 'spec_score',
    label: 'Sensor',
    long: 'Detection specificity',
    d: 3,
    color: '#8e1918',
    primary: true,
    scale: 'Unbounded, ≥ 0. Primary metric for RADAR sensor suitability.',
    formula: 'Sensor(g) = max(log2FC, 0) × max(detection_P − detection_ref, 0) / 100',
    summary:
      'Rewards near-binary targets: ON in most pathogenic cells, OFF in healthy ones — exactly what a thresholded RNA sensor needs.',
    terms: [
      ['log2FC', 'Fold-change in expression level, pathogenic vs reference.'],
      ['detection_P − detection_ref', 'Difference in the percentage of cells expressing the gene at all. A level change is not enough — the sensor needs the gene present in the cell.'],
    ],
  },
  RACS: {
    key: 'RACS',
    label: 'RACS',
    long: 'RADAR compatibility',
    d: 3,
    color: '#8e1918',
    scale: 'Product of four factors, each 0–1. Higher is better. Magnitudes are provisional until the Hill curve is calibrated.',
    formula: 'RACS(g) = Sep × Feas × Repro × (1 − OffMax)',
    summary:
      'The end-to-end sensor score: a target must be specific AND reach the activation threshold AND repeat across donors AND stay quiet off-target. Multiplicative, so any single failure kills it.',
    terms: [
      ['Sep', 'Donor-level AUC separating pathogenic donors from off-target donors. 0.5 = no separation, 1.0 = perfect.'],
      ['Feas', 'Mean RADAR activation in pathogenic cells at the operating threshold — does the target actually clear the threshold?'],
      ['Repro', '1 − CV of activation across pathogenic donors. Fires in every patient → high; driven by one patient → low.'],
      ['OffMax', 'Worst-case activation in any off-target population (healthy, bystander cell types). Worst-case, not averaged — a sensor firing anywhere off-target is unsafe.'],
    ],
  },
  DSS: {
    key: 'DSS',
    label: 'DSS',
    long: 'Disease specificity',
    d: 2,
    color: '#1c7170',
    scale: 'Unbounded, ≥ 0. Genes not up-regulated in disease score exactly 0.',
    formula: 'DSS(g) = max(log2FC, 0) × log10(mean_P + 1)',
    summary: 'Classic disease-marker score: how strongly up-regulated the gene is, weighted by how abundant it is in the pathogenic cells.',
    terms: [
      ['log2FC', 'Log2 ratio of mean expression, pathogenic vs healthy counterpart. Clipped at 0 so down-regulated genes score 0.'],
      ['mean_P', 'Mean expression in pathogenic cells (CP10k), averaged per donor.'],
    ],
  },
  RCS: {
    key: 'RCS',
    label: 'Consensus',
    long: 'Consensus score',
    d: 1,
    color: '#1c7170',
    displayKey: 'spec_score',
    displayLabel: 'Sensor score',
    displayD: 3,
    scale:
      'Percentile consensus across cohorts and metrics. When sorting by Consensus, the bar shows Sensor score for readability.',
    formula: 'Consensus(g) = [ Σ_cohorts Σ_metrics  w_cohort · w_metric · percentile(g) ] × coverage(g)',
    summary:
      'Averages each gene’s percentile rank across every cohort AND every metric, then penalises genes missing from some cohorts.',
    terms: [
      ['percentile(g)', 'The gene’s rank within one cohort on one metric, 0–100 (100 = best). Using ranks, not raw values, makes the score immune to scale and calibration.'],
      ['w_cohort = √(donors)', 'Bigger cohorts count more. A 39-donor cohort outweighs a 3-donor one.'],
      ['w_metric', 'Sensor 1.0 · DSS 1.0 · log2FC 0.8 · Sep 0.3 · Detection 0.3 — weighted toward disease specificity.'],
      ['coverage(g) = 0.5 + 0.5·(cohorts with the gene / all cohorts)', 'A gene found in 1 of 4 cohorts cannot outrank one reproduced in all 4.'],
    ],
  },
}

// Categorical palette for cell types etc. — brand-forward, muted, no neon.
export const PALETTE = [
  '#8e1918', '#1c7170', '#b45150', '#5aa3a2', '#c98a2b',
  '#6b6b6b', '#4a6d8c', '#8a6ea3', '#a3a3a3', '#3f7d54',
  '#c25b7a', '#7a8a3f', '#2f5d5c', '#b8823a', '#555555',
]

export const fmt = (v, d = 3) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d)

/** Min–max donors per cohort (not summed — pooled ranking keeps cohorts separate). */
export function donorRangeFromCohorts(cohorts, field = 'p_donors') {
  const vals = (cohorts || [])
    .map((c) => c.comparison?.[field])
    .filter((n) => typeof n === 'number' && n > 0)
  if (!vals.length) return null
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  return { lo, hi, label: lo === hi ? `${hi}` : `${lo}–${hi}` }
}

// True if the field exists (and isn't null) on the first record.
export const hasCol = (rows, key) =>
  Array.isArray(rows) && rows.length > 0 && rows[0][key] !== undefined && rows[0][key] !== null

// Reds-style sequential colormap on t in [0,1] → 'rgb(...)'. White → crimson.
export function reds(t) {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  // interpolate #fff5f0 (near-white) → #8e1918 (crimson), gamma-ish for punch
  const g = Math.pow(x, 0.85)
  const r = Math.round(255 + (142 - 255) * g)
  const gg = Math.round(245 + (25 - 245) * g)
  const b = Math.round(240 + (24 - 240) * g)
  return `rgb(${r},${gg},${b})`
}

// Min/max of a numeric field, robust to missing values.
export function extent(rows, key) {
  let lo = Infinity
  let hi = -Infinity
  for (const r of rows) {
    const v = r[key]
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (lo === Infinity) return [0, 1]
  if (lo === hi) return [lo - 0.5, hi + 0.5]
  return [lo, hi]
}

// Trigger a browser download of a Blob.
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Export an array of gene objects to CSV (respects a column order).
export function exportCsv(rows, filename = 'racs_table.csv') {
  if (!rows.length) return
  const cols = [
    'gene', 'RACS', 'DSS', 'Sep', 'Feas', 'Repro', 'OffMax',
    'detect_P', 'log2FC', 'FDR', 'celltype_spec', 'disease_spec',
    'k_op', 'Youden_J', 'n_donors', 'act_P', 'act_H', 'act_B', 'act_R',
  ]
  const present = cols.filter((c) => c in rows[0])
  const header = present.join(',')
  const body = rows
    .map((r) =>
      present
        .map((c) => {
          const val = r[c]
          if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
            return `"${val.replace(/"/g, '""')}"`
          }
          return val ?? ''
        })
        .join(','),
    )
    .join('\n')
  downloadBlob(new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8' }), filename)
}

// Locate the <svg> a recharts container rendered inside `container`, clone it,
// inline a white background + font, and hand back a serialized standalone SVG.
function serializeChartSvg(container) {
  const svg = container?.querySelector('svg')
  if (!svg) return null
  const clone = svg.cloneNode(true)
  const width = svg.clientWidth || svg.getBoundingClientRect().width || 600
  const height = svg.clientHeight || svg.getBoundingClientRect().height || 360
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', width)
  clone.setAttribute('height', height)
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  // white background rect so exported file isn't transparent
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('width', '100%')
  rect.setAttribute('height', '100%')
  rect.setAttribute('fill', '#ffffff')
  clone.insertBefore(rect, clone.firstChild)
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent =
    "text{font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;}"
  clone.insertBefore(style, clone.firstChild)
  return { markup: new XMLSerializer().serializeToString(clone), width, height }
}

export function downloadChartSvg(container, filename = 'chart.svg') {
  const out = serializeChartSvg(container)
  if (!out) return
  downloadBlob(new Blob([out.markup], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

// Rasterize the chart SVG to PNG via a canvas (2x for crispness).
export function downloadChartPng(container, filename = 'chart.png') {
  const out = serializeChartSvg(container)
  if (!out) return
  const { markup, width, height } = out
  const scale = 2
  const img = new Image()
  const svgBlob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename)
    }, 'image/png')
  }
  img.onerror = () => URL.revokeObjectURL(url)
  img.src = url
}
