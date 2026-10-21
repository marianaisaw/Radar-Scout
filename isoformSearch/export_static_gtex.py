"""Write the GTEx isoform lookup the hosted site can load without the API.

The candidate database stays local. This export keeps, per gene, the transcript
ids already stored on those candidates and their mean TPM in each long-read
cell type.
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from pathlib import Path

from isoformSearch.tpm import core_transcript_id, load_tissue_mean_tpm, tissue_options

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "radar_candidates.db"
OUT_DIR = ROOT / "frontend" / "public" / "gtex"


def shard_key(symbol: str) -> str:
    compact = "".join(ch for ch in symbol.upper() if ch.isalnum())
    prefix = (compact[:2] or "ZZ").ljust(2, "Z")
    return prefix


def gene_transcripts() -> dict[str, set[str]]:
    connection = sqlite3.connect(f"file:{DB_PATH.resolve()}?mode=ro&immutable=1", uri=True)
    genes: dict[str, set[str]] = {}
    try:
        cursor = connection.execute('SELECT gene, matches FROM candidates')
        for n, (gene, matches) in enumerate(cursor, start=1):
            key = str(gene or "").strip().upper()
            if not key:
                continue
            bucket = genes.get(key)
            if bucket is None:
                bucket = set()
                genes[key] = bucket
            if matches:
                for part in str(matches).split(";"):
                    part = part.strip()
                    if part:
                        bucket.add(part)
            if n % 500_000 == 0:
                print(f"  scanned {n:,} candidate rows, {len(genes):,} genes")
    finally:
        connection.close()
    return genes


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"Missing {DB_PATH}")
    print("Reading candidate transcript ids...")
    genes = gene_transcripts()
    print(f"{len(genes):,} genes")
    print("Loading GTEx long-read means...")
    tpm_index, counts = load_tissue_mean_tpm()
    tissues = tissue_options()
    tissues = [name for name in tissues if name in tpm_index.columns]

    shards: dict[str, dict] = defaultdict(dict)
    for symbol, ids in genes.items():
        kept_ids = []
        matrix = []
        for transcript_id in sorted(ids):
            core = core_transcript_id(transcript_id)
            if core not in tpm_index.index:
                continue
            values = [round(float(tpm_index.at[core, tissue]), 4) for tissue in tissues]
            if max(values) <= 0:
                continue
            kept_ids.append(transcript_id)
            matrix.append(values)
        shards[shard_key(symbol)][symbol] = {"ids": kept_ids, "tpm": matrix}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.json"):
        old.unlink()
    meta = {
        "tissues": tissues,
        "sample_counts": {tissue: int(counts.get(tissue, 0)) for tissue in tissues},
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    for prefix, payload in shards.items():
        (OUT_DIR / f"{prefix}.json").write_text(json.dumps(payload, separators=(",", ":")))
    print(f"Wrote {len(shards)} shards to {OUT_DIR}")


if __name__ == "__main__":
    main()
