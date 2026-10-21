function u16(view, offset) {
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  return view.getUint32(offset, true);
}

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  throw new Error("That file is not a readable zip archive.");
}

function listEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const eocd = findEocd(bytes);
  const count = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (u32(view, offset) !== 0x02014b50) break;
    const method = u16(view, offset + 10);
    const compressed = u32(view, offset + 20);
    const uncompressed = u32(view, offset + 24);
    const nameLen = u16(view, offset + 28);
    const extraLen = u16(view, offset + 30);
    const commentLen = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLen));
    entries.push({ name, method, compressed, uncompressed, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buffer, entry) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const start = entry.localOffset;
  if (u32(view, start) !== 0x04034b50) {
    throw new Error(`Could not read ${entry.name.split("/").pop()} from the zip.`);
  }
  const nameLen = u16(view, start + 26);
  const extraLen = u16(view, start + 28);
  const dataStart = start + 30 + nameLen + extraLen;
  const packed = bytes.slice(dataStart, dataStart + entry.compressed);
  if (entry.method === 0) return packed;
  if (entry.method === 8) {
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error(`Unsupported zip compression in ${entry.name.split("/").pop()}.`);
}

function firstLine(bytes) {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 10) {
      end = i;
      break;
    }
  }
  return new TextDecoder().decode(bytes.slice(0, end)).replace(/\r$/, "");
}

function countDataRows(bytes) {
  let lines = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 10) lines += 1;
  }
  if (bytes.length && bytes[bytes.length - 1] !== 10) lines += 1;
  return Math.max(0, lines - 1);
}

function pickMatrix(entries) {
  const files = entries.filter((entry) => !entry.name.endsWith("/"));
  return (
    files.find((entry) => entry.name.toLowerCase().endsWith("expression-matrix.tsv")) ||
    files.find(
      (entry) =>
        entry.name.toLowerCase().includes("expression-matrix") &&
        /\.(tsv|csv|txt)$/i.test(entry.name)
    ) ||
    null
  );
}

function sampleIds(columns) {
  const samples = [];
  const seen = new Set();
  for (const column of columns) {
    const match = column.match(/^(.+)_(cpm|count|tpm|fpkm)$/i);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    samples.push(match[1]);
  }
  return samples;
}

function labelsFromEntries(entries, samples) {
  const labels = Object.fromEntries(samples.map((sample) => [sample, ""]));
  for (const entry of entries) {
    const base = entry.name.split("/").pop();
    for (const sample of samples) {
      if (!base.toLowerCase().startsWith(sample.toLowerCase())) continue;
      const rest = base
        .slice(sample.length)
        .replace(/^_\d+_/, "_")
        .replace(/\.[^.]+$/, "")
        .replace(/^_+/, "")
        .replace(/_/g, " ")
        .trim();
      if (rest.length > (labels[sample] || "").length) labels[sample] = rest;
    }
  }
  return labels;
}

const DISEASE_TOKENS = {
  keloid: ["kelfib", "keloid"],
  cardiac: ["heart", "cardiac"],
  kidney: ["kidney", "renal"],
  liver: ["liver", "stellate"],
  pulmonary: ["lung", "pulmonary", "ipf"],
};

function blobFor(sample, label) {
  return `${sample} ${label || ""}`.toLowerCase();
}

function assignGroups(samples, labels, diseaseId) {
  const diseaseTokens = DISEASE_TOKENS[diseaseId] || [];
  const healthyTokens = ["hdf", "nhdf", "healthy", "control", "mock", "normal", "untransfected"];
  const offTokens = ["hek", "293t", "293", "sensor"];
  const P = [];
  const H = [];
  const B = [];
  for (const sample of samples) {
    const blob = blobFor(sample, labels[sample]);
    if (diseaseTokens.some((token) => blob.includes(token))) P.push(sample);
    else if (offTokens.some((token) => blob.includes(token))) B.push(sample);
    else if (healthyTokens.some((token) => blob.includes(token))) H.push(sample);
    else B.push(sample);
  }
  if (!P.length && samples.length) P.push(samples[samples.length - 1]);
  const rest = samples.filter((sample) => !P.includes(sample));
  if (!H.length) H.push(...rest);
  const pSet = new Set(P);
  const hSet = new Set(H.filter((sample) => !pSet.has(sample)));
  return {
    P: [...pSet],
    H: [...hSet],
    B: B.filter((sample) => !pSet.has(sample) && !hSet.has(sample)),
  };
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function num(row, index) {
  if (index < 0) return 0;
  const value = Number(row[index]);
  return Number.isFinite(value) ? value : 0;
}

function scoreRows(text, columns, groups) {
  const delim = text.split("\n", 1)[0].includes("\t") ? "\t" : ",";
  const nameIdx = columns.findIndex((column) => /^(gene_name|gene|symbol)$/i.test(column));
  const bioIdx = columns.findIndex((column) => /biotype/i.test(column));
  const cpmIdx = Object.fromEntries(
    [...groups.P, ...groups.H, ...groups.B].map((sample) => [
      sample,
      columns.findIndex((column) => column.toLowerCase() === `${sample.toLowerCase()}_cpm`),
    ]),
  );
  const genes = [];
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const row = line.split(delim);
    const biotype = bioIdx >= 0 ? row[bioIdx] : "";
    if (biotype && biotype !== "protein_coding") continue;
    const gene = (nameIdx >= 0 ? row[nameIdx] : row[0] || "").trim();
    if (!gene || gene === "NA") continue;
    const cpmP = groups.P.map((sample) => num(row, cpmIdx[sample]));
    const cpmH = groups.H.map((sample) => num(row, cpmIdx[sample]));
    const cpmB = groups.B.map((sample) => num(row, cpmIdx[sample]));
    const mean_P = mean(cpmP);
    const mean_H = mean(cpmH);
    const mean_B = mean(cpmB);
    if (mean_P < 1 && mean_H < 1) continue;
    const log2FC = Math.log2((mean_P + 1) / (mean_H + 1));
    const occP = mean_P / (mean_P + 5);
    const occH = mean_H / (mean_H + 5);
    const detect_P = 100 * occP;
    const detect_H = 100 * occH;
    const spec_score = Math.max(log2FC, 0) * Math.max(occP - occH, 0);
    const DSS = Math.max(log2FC, 0) * Math.log10(mean_P + 1);
    genes.push({
      gene,
      spec_score: Number(spec_score.toFixed(4)),
      DSS: Number(DSS.toFixed(4)),
      log2FC: Number(log2FC.toFixed(4)),
      detect_P: Number(detect_P.toFixed(2)),
      detect_H: Number(detect_H.toFixed(2)),
      delta_detect: Number((detect_P - detect_H).toFixed(2)),
      mean_P: Number(mean_P.toFixed(3)),
      mean_H: Number(mean_H.toFixed(3)),
      mean_B: Number(mean_B.toFixed(3)),
      n_cohorts: 1,
    });
  }
  genes.sort((a, b) => b.spec_score - a.spec_score || b.DSS - a.DSS);
  genes.forEach((row, i) => {
    row.RCS = Number((((genes.length - i) / genes.length) * 100).toFixed(1));
  });
  return genes;
}

function inspectFrom(file, entries, matrix, payload) {
  const header = firstLine(payload);
  const sep = header.includes("\t") ? "\t" : ",";
  const columns = header.split(sep);
  const samples = sampleIds(columns);
  return {
    filename: file.name,
    bytes: file.size,
    matrix: matrix.name.split("/").pop(),
    genes: countDataRows(payload),
    samples,
    has_cpm: columns.some((column) => column.toLowerCase().endsWith("_cpm")),
    has_count: columns.some((column) => column.toLowerCase().endsWith("_count")),
    columns,
    payload,
    entries,
  };
}

export async function inspectBulkZip(file) {
  const buffer = await file.arrayBuffer();
  const entries = listEntries(buffer);
  const matrix = pickMatrix(entries);
  if (!matrix) {
    throw new Error("No expression matrix in this zip. Expected a file like ZXRTWC-expression-matrix.tsv.");
  }
  const payload = await readEntry(buffer, matrix);
  const preview = inspectFrom(file, entries, matrix, payload);
  delete preview.payload;
  delete preview.entries;
  delete preview.columns;
  return preview;
}

export async function analyzeBulkZip(file, diseaseId) {
  const buffer = await file.arrayBuffer();
  const entries = listEntries(buffer);
  const matrix = pickMatrix(entries);
  if (!matrix) {
    throw new Error("No expression matrix in this zip. Expected a file like ZXRTWC-expression-matrix.tsv.");
  }
  const payload = await readEntry(buffer, matrix);
  const preview = inspectFrom(file, entries, matrix, payload);
  const labels = labelsFromEntries(entries, preview.samples);
  const groups = assignGroups(preview.samples, labels, diseaseId);
  if (!groups.P.length || !groups.H.length) {
    throw new Error("Need at least one pathogenic and one healthy library in the expression matrix.");
  }
  const text = new TextDecoder().decode(payload);
  const genes = scoreRows(text, preview.columns, groups);
  if (!genes.length) {
    throw new Error("No expressed protein-coding genes found in that matrix.");
  }
  const nameOf = (sample) => labels[sample] || sample;
  return {
    filename: preview.filename,
    matrix: preview.matrix,
    samples: preview.samples,
    labels,
    groups,
    genes,
    contrast: `${groups.P.map(nameOf).join(", ")} vs ${groups.H.map(nameOf).join(", ")}`,
    diseaseId,
  };
}
