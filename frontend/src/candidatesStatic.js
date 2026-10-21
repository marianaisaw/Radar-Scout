const SORTS = {
  "Isoform coverage": "isoform_coverage_fraction",
  "Transcript count": "transcript_count",
  GC: "GC",
  "Sensor length": "length",
};

const shardCache = new Map();
let catalogPromise = null;

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
  return parent ? parent.toUpperCase() : null;
}

function transcriptIds(matches) {
  return String(matches || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function loadShard(prefix) {
  if (!shardCache.has(prefix)) {
    shardCache.set(
      prefix,
      fetch(`/candidates/${prefix}.json.gz`).then(async (response) => {
        if (!response.ok) return {};
        const bytes = await response.arrayBuffer();
        const text = await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
        ).text();
        return JSON.parse(text);
      })
    );
  }
  return shardCache.get(prefix);
}

async function loadEntry(symbol) {
  const requested = String(symbol || "").trim().toUpperCase();
  if (!requested) return { entry: null, gene: requested, aliasedFrom: null };
  const direct = (await loadShard(shardKey(requested)))[requested];
  if (direct) return { entry: direct, gene: requested, aliasedFrom: null };
  const parent = parentGene(requested);
  if (!parent) return { entry: null, gene: requested, aliasedFrom: null };
  const fallback = (await loadShard(shardKey(parent)))[parent];
  if (!fallback) return { entry: null, gene: requested, aliasedFrom: null };
  return { entry: fallback, gene: parent, aliasedFrom: requested };
}

function rowObject(gene, entry, raw) {
  const [
    variant,
    length,
    regionType,
    sensor,
    candidate,
    sensorTln,
    gc,
    longest,
    totalHomo,
    matches,
    transcriptCount,
    coverage,
  ] = raw;
  const ids = transcriptIds(matches);
  const record = {
    gene,
    gene_id: entry.gid,
    variant,
    length,
    region_type: regionType,
    sensor,
    candidate,
    sensor_tln: sensorTln,
    GC: gc,
    longest_homopolymer: longest,
    total_homopolymer: totalHomo,
    matches,
    transcript_count: transcriptCount,
    transcript_ids: ids.join(";"),
    isoform_coverage_fraction: coverage,
  };
  record.id = [
    gene,
    entry.gid,
    variant,
    length,
    regionType,
    sensor,
    candidate,
    sensorTln,
    gc,
    longest,
    totalHomo,
    matches,
  ]
    .map((value) => (value == null ? "" : String(value)))
    .join("||");
  return record;
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true })
  );
}

export async function staticOverview(symbol) {
  const { entry, gene, aliasedFrom } = await loadEntry(symbol);
  if (!entry) throw new Error(`No RADAR candidates found for ${String(symbol || "").toUpperCase()}.`);
  const rows = entry.rows.map((raw) => rowObject(gene, entry, raw));
  return {
    gene,
    aliased_from: aliasedFrom,
    summary: {
      total_candidates: entry.n,
      total_unique_transcripts: entry.u,
      matching_one: entry.one,
      matching_multiple: entry.multi,
      matching_all_represented: entry.all,
    },
    isoforms: entry.iso,
    sort_options: Object.keys(SORTS),
    filters: {
      region_types: uniqueSorted(rows.map((row) => row.region_type)),
      variants: uniqueSorted(rows.map((row) => row.variant)),
      lengths: uniqueSorted(rows.map((row) => row.length)),
    },
  };
}

function applyFilters(rows, body) {
  const regions = new Set(body.region_types || []);
  const variants = new Set(body.variants || []);
  const lengths = new Set(body.lengths || []);
  const isoforms = body.isoforms;
  if (!regions.size || !variants.size || !lengths.size) return [];
  const wanted = Array.isArray(isoforms) ? new Set(isoforms) : null;
  if (wanted && !wanted.size) return [];
  const minCount = Number(body.min_transcript_count || 0);
  const minCoverage = Number(body.min_coverage || 0);
  return rows.filter((row) => {
    if (!regions.has(row.region_type)) return false;
    if (!variants.has(row.variant)) return false;
    if (!lengths.has(row.length)) return false;
    if (wanted && !transcriptIds(row.matches).some((id) => wanted.has(id))) return false;
    if (Number(row.transcript_count) < minCount) return false;
    if (Number(row.isoform_coverage_fraction) < minCoverage) return false;
    return true;
  });
}

export async function staticSearch(body) {
  const { entry, gene } = await loadEntry(body.gene);
  if (!entry) throw new Error(`No RADAR candidates found for ${String(body.gene || "").toUpperCase()}.`);
  const all = entry.rows.map((raw) => rowObject(gene, entry, raw));
  const filtered = applyFilters(all, body);
  const key = SORTS[body.sort] || SORTS["Isoform coverage"];
  const direction = body.descending === false ? 1 : -1;
  filtered.sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (left < right) return -1 * direction;
    if (left > right) return 1 * direction;
    return 0;
  });
  const pageSize = Math.max(1, Math.min(Number(body.page_size) || 8, 100000));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(Number(body.page) || 1, 1), pages);
  const start = (page - 1) * pageSize;
  return {
    gene,
    total: filtered.length,
    page,
    pages,
    page_size: pageSize,
    rows: filtered.slice(start, start + pageSize),
    unique_transcripts: entry.u,
    unfiltered: entry.n,
  };
}

export async function staticSite(gene, matches) {
  const { entry } = await loadEntry(gene);
  const isoforms = entry?.iso || [];
  const presentIds = new Set(transcriptIds(matches));
  const presence = isoforms.map((transcript) => ({
    ensembl_transcript: transcript,
    site_present: presentIds.has(transcript),
  }));
  return {
    present: presence.filter((row) => row.site_present).length,
    total: isoforms.length,
    isoforms: presence,
  };
}

export async function staticSuggest(query) {
  if (!catalogPromise) {
    catalogPromise = fetch("/gene-catalog.json").then((response) => (response.ok ? response.json() : {}));
  }
  const catalog = await catalogPromise;
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return ["ADAM12", "POSTN", "ASPN", "COL11A1", "SFRP4", "SPP1"];
  const hits = [];
  for (const [key, symbol] of Object.entries(catalog)) {
    if (key.includes(needle) || String(symbol).toLowerCase().includes(needle)) {
      hits.push(symbol);
      if (hits.length >= 12) break;
    }
  }
  return hits;
}

export function staticCsv(rows) {
  const columns = [
    "gene",
    "gene_id",
    "variant",
    "length",
    "region_type",
    "sensor",
    "candidate",
    "sensor_tln",
    "GC",
    "longest_homopolymer",
    "total_homopolymer",
    "matches",
    "transcript_count",
    "transcript_ids",
    "isoform_coverage_fraction",
  ];
  const lines = [columns.join(",")];
  rows.forEach((row) => {
    lines.push(
      columns
        .map((key) => {
          const value = row[key] == null ? "" : String(row[key]);
          return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
        })
        .join(",")
    );
  });
  return lines.join("\n");
}
