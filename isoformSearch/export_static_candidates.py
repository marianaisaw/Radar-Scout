"""Write per-prefix candidate tables for the hosted site.

The full SQLite file is too large for Vercel. Each shard is a gzipped JSON
object keyed by gene symbol, holding the rows the candidates page filters.
"""

from __future__ import annotations

import gzip
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "radar_candidates.db"
OUT_DIR = ROOT / "frontend" / "public" / "candidates"
CATALOG_SRC = ROOT / "gene_catalog.json"
CATALOG_DST = ROOT / "frontend" / "public" / "gene-catalog.json"


def shard_key(symbol: str) -> str:
    compact = "".join(ch for ch in symbol.upper() if ch.isalnum())
    return (compact[:2] or "ZZ").ljust(2, "Z")


def transcript_ids(matches) -> list[str]:
    if not matches:
        return []
    return [part.strip() for part in str(matches).split(";") if part.strip()]


def pack_gene(symbol: str, rows: list[sqlite3.Row]) -> dict:
    parsed = [transcript_ids(row["matches"]) for row in rows]
    unique: set[str] = set()
    for ids in parsed:
        unique.update(ids)
    total_unique = len(unique)
    packed = []
    one = multi = all_represented = 0
    gene_id = rows[0]["gene_id"]
    for row, ids in zip(rows, parsed):
        count = len(ids)
        coverage = (count / total_unique) if total_unique else 0.0
        if count == 1:
            one += 1
        if count > 1:
            multi += 1
        if total_unique and count == total_unique:
            all_represented += 1
        gc = row["GC"]
        packed.append(
            [
                row["variant"],
                int(row["length"]) if row["length"] is not None else None,
                row["region_type"],
                row["sensor"],
                row["candidate"],
                row["sensor_tln"],
                round(float(gc), 5) if gc is not None else None,
                row["longest_homopolymer"],
                row["total_homopolymer"],
                row["matches"] or "",
                count,
                round(coverage, 6),
            ]
        )
    return {
        "gid": gene_id,
        "n": len(rows),
        "u": total_unique,
        "one": one,
        "multi": multi,
        "all": all_represented,
        "iso": sorted(unique),
        "rows": packed,
    }


def write_shard(prefix: str, payload: dict) -> None:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    with gzip.open(OUT_DIR / f"{prefix}.json.gz", "wb", compresslevel=6) as handle:
        handle.write(raw)


def main() -> None:
    if not DB_PATH.exists():
        raise SystemExit(f"Missing {DB_PATH}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.json.gz"):
        old.unlink()
    if CATALOG_SRC.exists():
        CATALOG_DST.write_bytes(CATALOG_SRC.read_bytes())

    connection = sqlite3.connect(f"file:{DB_PATH.resolve()}?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    cursor = connection.execute("SELECT * FROM candidates ORDER BY gene COLLATE NOCASE")

    current_key = None
    current_prefix = None
    buffer: list[sqlite3.Row] = []
    shard: dict = {}
    genes = 0

    def flush_gene() -> None:
        nonlocal genes
        if current_key and buffer:
            shard[current_key] = pack_gene(current_key, buffer)
            genes += 1

    def flush_shard() -> None:
        if current_prefix and shard:
            write_shard(current_prefix, shard)
            print(f"  {current_prefix}: {len(shard)} genes")

    for row in cursor:
        key = str(row["gene"] or "").strip().upper()
        if not key:
            continue
        prefix = shard_key(key)
        if key != current_key:
            flush_gene()
            buffer = []
            current_key = key
        if prefix != current_prefix:
            flush_shard()
            shard = {}
            current_prefix = prefix
        buffer.append(row)
    flush_gene()
    flush_shard()
    connection.close()
    print(f"Wrote {genes:,} genes to {OUT_DIR}")


if __name__ == "__main__":
    main()
