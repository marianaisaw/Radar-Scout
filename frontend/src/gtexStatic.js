const DEFAULT_TISSUE = "Cells - Cultured fibroblasts";
const TISSUE_ALIASES = {
  kidney: DEFAULT_TISSUE,
  "kidney fibrosis": DEFAULT_TISSUE,
  "kidney - cortex": DEFAULT_TISSUE,
  "cells - cultured fibroblasts": DEFAULT_TISSUE,
};

const metaCache = { current: null };
const shardCache = new Map();

function shardKey(symbol) {
  const compact = String(symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return (compact.slice(0, 2) || "ZZ").padEnd(2, "Z");
}

function parentGene(symbol) {
  const match = String(symbol || "").match(/[-_](AS|IT|DT)\d*$/i);
  if (!match) return null;
  const parent = symbol.slice(0, match.index).trim();
  return parent || null;
}

function resolveTissue(tissue, names) {
  const wanted = String(tissue || "").trim();
  if (names.includes(wanted)) return wanted;
  const alias = TISSUE_ALIASES[wanted.toLowerCase()];
  if (alias && names.includes(alias)) return alias;
  const found = names.find((name) => name.toLowerCase() === wanted.toLowerCase());
  if (found) return found;
  if (names.includes(DEFAULT_TISSUE)) return DEFAULT_TISSUE;
  return names[0] || DEFAULT_TISSUE;
}

async function loadMeta() {
  if (!metaCache.current) {
    const response = await fetch("/gtex/meta.json");
    if (!response.ok) throw new Error("GTEx isoform table is not available.");
    metaCache.current = response.json();
  }
  return metaCache.current;
}

async function loadShard(prefix) {
  if (!shardCache.has(prefix)) {
    shardCache.set(
      prefix,
      fetch(`/gtex/${prefix}.json`).then((response) => {
        if (!response.ok) return {};
        return response.json();
      })
    );
  }
  return shardCache.get(prefix);
}

function rowsForTissue(entry, tissueIndex) {
  const rows = [];
  entry.ids.forEach((transcript, index) => {
    const tpm = Number(entry.tpm[index]?.[tissueIndex] || 0);
    if (tpm > 0) rows.push({ Transcript: transcript, TPM: tpm });
  });
  rows.sort((a, b) => b.TPM - a.TPM);
  const total = rows.reduce((sum, row) => sum + row.TPM, 0);
  rows.forEach((row) => {
    row["Rel. %"] = total > 0 ? (100 * row.TPM) / total : 0;
  });
  return rows;
}

export async function staticExpression(gene, tissue) {
  const meta = await loadMeta();
  const tissues = meta.tissues || [];
  const requested = String(gene || "").trim().toUpperCase();
  const chosen = resolveTissue(tissue, tissues);
  const tissueIndex = tissues.indexOf(chosen);

  async function lookup(symbol) {
    const shard = await loadShard(shardKey(symbol));
    return shard[symbol.toUpperCase()] || null;
  }

  let entry = await lookup(requested);
  let aliasedFrom = null;
  if (!entry) {
    const parent = parentGene(requested);
    if (parent) {
      entry = await lookup(parent);
      if (entry) aliasedFrom = requested;
    }
  }

  return {
    gene: aliasedFrom ? parentGene(requested) : requested,
    aliased_from: aliasedFrom,
    tissue: chosen,
    requested_tissue: tissue || chosen,
    tissues,
    sample_count: meta.sample_counts?.[chosen] || 0,
    rows: entry && tissueIndex >= 0 ? rowsForTissue(entry, tissueIndex) : [],
  };
}
