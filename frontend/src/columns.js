export const CANDIDATE_COLUMNS = [
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

const DECIMAL = new Set(["GC", "isoform_coverage_fraction"]);
const SEQUENCE = new Set(["sensor", "candidate", "sensor_tln", "matches", "transcript_ids", "gene_id"]);

export function formatCell(key, value) {
  if (value == null || value === "") return "";
  if (DECIMAL.has(key)) return Number(value).toFixed(3);
  return String(value);
}

export function cellClass(key) {
  return SEQUENCE.has(key) ? "mono seq" : "";
}
