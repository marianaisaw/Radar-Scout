"""Streamlit-free RADAR data helpers used by the FastAPI backend."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd
import sqlite3

DB_PATH = Path("radar_candidates.db")
CATALOG_PATH = Path("gene_catalog.json")
TABLE_NAME = "candidates"
GENE_COLUMN = "gene"

GAO_COLUMNS = [
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
]
DERIVED_COLUMNS = [
    "transcript_count",
    "transcript_ids",
    "isoform_coverage_fraction",
]
DISPLAY_COLUMNS = GAO_COLUMNS + DERIVED_COLUMNS
SORT_OPTIONS = {
    "Isoform coverage": "isoform_coverage_fraction",
    "Transcript count": "transcript_count",
    "GC": "GC",
    "Sensor length": "length",
}


def load_gene_catalog() -> dict:
    if not CATALOG_PATH.exists():
        return {}
    return json.loads(CATALOG_PATH.read_text())


def suggest_genes(query: str, limit: int = 12) -> list[str]:
    catalog = load_gene_catalog()
    if not query:
        return ["ADAM12", "POSTN", "ASPN", "COL11A1", "SFRP4", "SPP1"]
    needle = query.lower().strip()
    hits = []
    for key, symbol in catalog.items():
        if needle in key or needle in str(symbol).lower():
            hits.append(symbol)
            if len(hits) >= limit:
                break
    return hits


def parse_transcript_ids(matches_value):
    if pd.isna(matches_value):
        return []
    text = str(matches_value).strip()
    if not text:
        return []
    return [part.strip() for part in text.split(";") if part.strip()]


_NONCODING_SUFFIX = re.compile(r"[-_](AS|IT|DT)\d*$", re.IGNORECASE)


def parent_gene_symbol(gene_symbol: str) -> str | None:
    """NR2F2-AS1 → NR2F2, UBA6-DT → UBA6. None if the name has no such suffix."""
    text = str(gene_symbol or "").strip()
    match = _NONCODING_SUFFIX.search(text)
    if not match:
        return None
    parent = text[: match.start()].strip()
    return parent or None


def fetch_candidates_resolved(gene_symbol: str) -> tuple[pd.DataFrame, str, str | None]:
    """Load Gao sensors, falling back from antisense/divergent RNA names to the parent gene."""
    requested = str(gene_symbol or "").strip()
    raw = fetch_candidates(requested)
    if not raw.empty:
        canonical = str(raw.iloc[0][GENE_COLUMN])
        return raw, canonical, None
    parent = parent_gene_symbol(requested)
    if parent:
        raw = fetch_candidates(parent)
        if not raw.empty:
            canonical = str(raw.iloc[0][GENE_COLUMN])
            return raw, canonical, requested.upper()
    return raw, requested.upper(), None


def fetch_candidates(gene_symbol: str) -> pd.DataFrame:
    if not DB_PATH.exists():
        raise FileNotFoundError(
            "radar_candidates.db was not found. Run `python build_database.py`."
        )
    connection = sqlite3.connect(f"file:{DB_PATH.resolve()}?mode=ro&immutable=1", uri=True)
    try:
        query = f"""
            SELECT *
            FROM {TABLE_NAME}
            WHERE "{GENE_COLUMN}" = ? COLLATE NOCASE
        """
        return pd.read_sql_query(query, connection, params=[gene_symbol])
    finally:
        connection.close()


def annotate_isoform_coverage(candidates: pd.DataFrame):
    annotated = candidates.copy()
    id_lists = annotated["matches"].map(parse_transcript_ids)
    annotated["transcript_count"] = id_lists.map(len)
    annotated["transcript_ids"] = id_lists.map(lambda ids: ";".join(ids))
    unique_ids: set[str] = set()
    for ids in id_lists:
        unique_ids.update(ids)
    total_unique = len(unique_ids)
    if total_unique == 0:
        annotated["isoform_coverage_fraction"] = 0.0
    else:
        annotated["isoform_coverage_fraction"] = (
            annotated["transcript_count"] / total_unique
        )
    return annotated, sorted(unique_ids), total_unique


def gene_summary(annotated: pd.DataFrame, total_unique: int) -> dict:
    n = len(annotated)
    return {
        "total_candidates": int(n),
        "total_unique_transcripts": int(total_unique),
        "matching_one": int((annotated["transcript_count"] == 1).sum()),
        "matching_multiple": int((annotated["transcript_count"] > 1).sum()),
        "matching_all_represented": int(
            (annotated["transcript_count"] == total_unique).sum() if total_unique else 0
        ),
    }


def apply_filters(
    annotated: pd.DataFrame,
    region_types,
    variants,
    lengths,
    min_transcript_count,
    min_coverage,
    isoforms_of_interest=None,
):
    filtered = annotated
    if region_types:
        filtered = filtered[filtered["region_type"].isin(region_types)]
    else:
        return filtered.iloc[0:0]
    if variants:
        filtered = filtered[filtered["variant"].isin(variants)]
    else:
        return filtered.iloc[0:0]
    if lengths:
        filtered = filtered[filtered["length"].isin(lengths)]
    else:
        return filtered.iloc[0:0]
    if isoforms_of_interest is not None:
        if isoforms_of_interest:
            wanted = set(isoforms_of_interest)
            has_isoform = filtered["matches"].map(
                lambda value: bool(wanted.intersection(parse_transcript_ids(value)))
            )
            filtered = filtered[has_isoform]
        else:
            return filtered.iloc[0:0]
    filtered = filtered[filtered["transcript_count"] >= min_transcript_count]
    filtered = filtered[filtered["isoform_coverage_fraction"] >= min_coverage]
    return filtered


def apply_sort(filtered: pd.DataFrame, sort_label: str, descending: bool):
    column = SORT_OPTIONS.get(sort_label, "isoform_coverage_fraction")
    if column not in filtered.columns:
        return filtered
    return filtered.sort_values(column, ascending=not descending)


def display_columns(frame: pd.DataFrame) -> pd.DataFrame:
    cols = [c for c in DISPLAY_COLUMNS if c in frame.columns]
    return frame[cols]


def candidate_key(row) -> str:
    parts = []
    for column in GAO_COLUMNS:
        if column not in row.index or pd.isna(row[column]):
            parts.append("")
        else:
            parts.append(str(row[column]))
    return "||".join(parts)


def isoform_presence(unique_ids, matches_value):
    present = set(parse_transcript_ids(matches_value))
    return [
        {
            "ensembl_transcript": transcript_id,
            "site_present": transcript_id in present,
        }
        for transcript_id in unique_ids
    ]


def records(frame: pd.DataFrame) -> list[dict]:
    if frame.empty:
        return []
    clean = frame.where(pd.notnull(frame), None)
    return json.loads(clean.to_json(orient="records"))
