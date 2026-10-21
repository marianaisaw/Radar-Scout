"""FastAPI backend for the RADAR gene platform (replaces Streamlit UI)."""

from __future__ import annotations

import io
import re
import zipfile
from functools import lru_cache
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from isoformSearch.tpm import (
    DEFAULT_TISSUE,
    isoform_expression_table,
    load_tissue_mean_tpm,
    resolve_tissue,
    tissue_options,
)
from radar_core import (
    SORT_OPTIONS,
    annotate_isoform_coverage,
    apply_filters,
    apply_sort,
    candidate_key,
    display_columns,
    fetch_candidates_resolved,
    gene_summary,
    isoform_presence,
    records,
    suggest_genes,
)

app = FastAPI(title="RADAR gene platform", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_GENE_CACHE: dict[str, tuple[pd.DataFrame, list[str], int]] = {}


class SearchBody(BaseModel):
    gene: str
    page: int = 1
    page_size: int = 8
    sort: str = "Isoform coverage"
    descending: bool = True
    region_types: list[str] | None = None
    variants: list[str] | None = None
    lengths: list[int] | None = None
    isoforms: list[str] | None = None
    min_transcript_count: int = 1
    min_coverage: float = 0.0


class AccessibilityBody(BaseModel):
    sequence: str
    candidate: str
    transcript_id: str = "transcript"
    w: int = 200
    l: int = 150
    u: int = 20
    mode: str = "full"


class FragmentBody(BaseModel):
    fragment: str
    codon: str = "UAG"
    flank: int = 5
    w: int | None = None
    l: int | None = None
    u: int = 20


class SensorBody(BaseModel):
    sequence: str = Field(min_length=2)


class SimulateBody(BaseModel):
    """Playground contract. params and conditions are schema-keyed dicts."""

    delivery: str
    system: str
    logic: str
    conditions: dict[str, Any] = Field(default_factory=dict)
    params: dict[str, Any] = Field(default_factory=dict)
    triggerLevels: dict[str, Any] = Field(default_factory=dict)
    tSpan: dict[str, Any] = Field(default_factory=dict)


def _gene_bundle(gene: str):
    key = gene.strip().upper()
    if not key:
        raise HTTPException(400, "Enter a gene symbol.")
    if key not in _GENE_CACHE:
        raw, canonical, aliased_from = fetch_candidates_resolved(key)
        if raw.empty:
            raise HTTPException(404, f"No RADAR candidates found for {key}.")
        annotated, unique_ids, total_unique = annotate_isoform_coverage(raw)
        payload = (canonical, annotated, unique_ids, total_unique, aliased_from)
        _GENE_CACHE[key] = payload
        if canonical.upper() != key:
            _GENE_CACHE[canonical.upper()] = (canonical, annotated, unique_ids, total_unique, None)
        if len(_GENE_CACHE) > 8:
            oldest = next(iter(_GENE_CACHE))
            if oldest not in {key, canonical.upper()}:
                _GENE_CACHE.pop(oldest, None)
    return _GENE_CACHE[key]


@lru_cache(maxsize=1)
def _tpm():
    return load_tissue_mean_tpm()


def _inspect_bulk_zip(raw: bytes, filename: str) -> dict[str, Any]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise HTTPException(400, "That file is not a readable zip archive.") from exc

    names = [name for name in archive.namelist() if not name.endswith("/")]
    matrix = next(
        (name for name in names if name.lower().endswith("expression-matrix.tsv")),
        None,
    )
    if matrix is None:
        matrix = next(
            (
                name
                for name in names
                if "expression-matrix" in name.lower()
                and name.lower().endswith((".tsv", ".csv", ".txt"))
            ),
            None,
        )
    if matrix is None:
        raise HTTPException(
            400,
            "No expression matrix in this zip. Expected a file like ZXRTWC-expression-matrix.tsv.",
        )

    with archive.open(matrix) as handle:
        header = handle.readline().decode("utf-8", errors="replace").rstrip("\n\r")
        sep = "\t" if "\t" in header else ","
        columns = header.split(sep)
        n_genes = sum(1 for _ in handle)

    samples: list[str] = []
    seen: set[str] = set()
    for column in columns:
        match = re.fullmatch(r"(.+)_(?:cpm|count|tpm|fpkm)", column, flags=re.I)
        if not match:
            continue
        sample = match.group(1)
        if sample not in seen:
            seen.add(sample)
            samples.append(sample)

    qc = [
        name.split("/")[-1]
        for name in names
        if name != matrix
        and name.lower().endswith((".html", ".png", ".txt", ".csv"))
        and any(token in name.lower() for token in ("multiqc", "methods", "pca", "mapping-stats", "biotype", "heatmap"))
    ]
    return {
        "filename": filename,
        "bytes": len(raw),
        "matrix": matrix.split("/")[-1],
        "genes": n_genes,
        "samples": samples,
        "has_cpm": any(col.lower().endswith("_cpm") for col in columns),
        "has_count": any(col.lower().endswith("_count") for col in columns),
        "qc": qc[:8],
    }


@app.post("/api/bulk-zip")
async def bulk_zip(file: UploadFile = File(...)):
    name = file.filename or "archive.zip"
    if not name.lower().endswith(".zip"):
        raise HTTPException(400, "Upload a .zip of bulk RNA-seq results.")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "The zip was empty.")
    if len(raw) > 400_000_000:
        raise HTTPException(413, "Archive is too large (400 MB limit).")
    return _inspect_bulk_zip(raw, name)


@app.get("/api/health")
def health():
    return {"ok": True, "name": "RADAR gene platform"}


@app.get("/api/suggest")
def suggest(q: str = ""):
    return {"genes": suggest_genes(q)}


@app.get("/api/gene/{gene}/overview")
def overview(gene: str):
    symbol, annotated, unique_ids, total_unique, aliased_from = _gene_bundle(gene)
    summary = gene_summary(annotated, total_unique)
    tissues = tissue_options()
    return {
        "gene": symbol,
        "aliased_from": aliased_from,
        "summary": summary,
        "isoforms": unique_ids,
        "tissues": tissues,
        "default_tissue": DEFAULT_TISSUE,
        "sort_options": list(SORT_OPTIONS),
        "filters": {
            "region_types": sorted(annotated["region_type"].dropna().unique().tolist()),
            "variants": sorted(annotated["variant"].dropna().unique().tolist()),
            "lengths": sorted(int(x) for x in annotated["length"].dropna().unique().tolist()),
        },
    }


def _filtered_frame(body: SearchBody) -> tuple[str, pd.DataFrame, pd.DataFrame, int]:
    symbol, annotated, unique_ids, total_unique, _aliased_from = _gene_bundle(body.gene)
    region_types = body.region_types or sorted(
        annotated["region_type"].dropna().unique().tolist()
    )
    variants = body.variants or sorted(annotated["variant"].dropna().unique().tolist())
    lengths = body.lengths or [
        int(x) for x in annotated["length"].dropna().unique().tolist()
    ]
    isoforms = body.isoforms if body.isoforms is not None else unique_ids
    filtered = apply_filters(
        annotated,
        region_types,
        variants,
        lengths,
        body.min_transcript_count,
        body.min_coverage,
        isoforms_of_interest=isoforms,
    )
    filtered = apply_sort(filtered, body.sort, body.descending)
    return symbol, annotated, filtered, total_unique


@app.post("/api/search")
def search(body: SearchBody):
    symbol, annotated, filtered, total_unique = _filtered_frame(body)
    total = int(len(filtered))
    page_size = max(1, min(body.page_size, 50))
    pages = max(1, (total + page_size - 1) // page_size) if total else 1
    page = min(max(body.page, 1), pages)
    start = (page - 1) * page_size
    chunk = display_columns(filtered.iloc[start : start + page_size])

    def _jsonify(value):
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        if pd.isna(value):
            return None
        if hasattr(value, "item"):
            return value.item()
        return value

    rows = []
    for _, row in chunk.iterrows():
        payload = {k: _jsonify(v) for k, v in row.items()}
        payload["id"] = candidate_key(row)
        rows.append(payload)
    return {
        "gene": symbol,
        "total": total,
        "page": page,
        "pages": pages,
        "page_size": page_size,
        "rows": rows,
        "unique_transcripts": total_unique,
        "unfiltered": int(len(annotated)),
    }


@app.post("/api/export")
def export_csv(body: SearchBody):
    symbol, _annotated, filtered, _total_unique = _filtered_frame(body)
    csv_text = display_columns(filtered).to_csv(index=False)
    filename = f"{symbol}_radar_candidates.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/gene/{gene}/site")
def site(gene: str, matches: str = Query("")):
    _symbol, _annotated, unique_ids, total_unique, _aliased = _gene_bundle(gene)
    presence = isoform_presence(unique_ids, matches)
    present = sum(1 for row in presence if row["site_present"])
    return {
        "present": present,
        "total": total_unique,
        "isoforms": presence,
    }


@app.get("/api/gene/{gene}/expression")
def expression(gene: str, tissue: str | None = None):
    symbol, _annotated, unique_ids, _total, aliased_from = _gene_bundle(gene)
    tpm_index, counts = _tpm()
    available = list(tpm_index.columns.drop("gencode_id", errors="ignore"))
    requested = tissue or DEFAULT_TISSUE
    chosen = resolve_tissue(requested, available)
    table = isoform_expression_table(unique_ids, tpm_index, chosen)
    return {
        "gene": symbol,
        "aliased_from": aliased_from,
        "tissue": chosen,
        "requested_tissue": requested,
        "tissues": tissue_options(),
        "sample_count": counts.get(chosen, 0),
        "rows": records(table) if not table.empty else [],
    }


@app.get("/api/fasta/{gene}")
def fasta(gene: str):
    from fasta import download_transcript_fasta, parse_fasta_records

    try:
        text, biotypes = download_transcript_fasta(gene)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    records_out = []
    for header, seq in parse_fasta_records(text):
        accession = header.split()[0]
        records_out.append(
            {
                "id": accession,
                "header": header,
                "length": len(seq),
                "biotype": biotypes.get(accession.split(".")[0], ""),
                "sequence": seq,
            }
        )
    return {
        "gene": gene.strip().upper(),
        "fasta": text,
        "n": len(records_out),
        "transcripts": records_out,
    }


def _downsample(xs: list[float], n: int = 480) -> list[float]:
    if len(xs) <= n:
        return xs
    step = len(xs) / n
    return [xs[int(i * step)] for i in range(n)]


@app.post("/api/accessibility")
def accessibility(body: AccessibilityBody):
    from rnaplfold.analysis import (
        calculate_accessibility_summary,
        extract_target_accessibility,
        find_best_windows_for_target,
        find_target_matches,
    )
    from rnaplfold.parser import parse_lunp_text
    from rnaplfold.runner import RNAplfoldError, run_rnaplfold
    from utils.fasta import FastaError, parse_fasta, strip_display_ellipsis

    try:
        parsed = parse_fasta(body.sequence)
        candidate, _meta = strip_display_ellipsis(body.candidate)
        result = run_rnaplfold(
            parsed.sequence,
            w=body.w,
            l=min(body.l, body.w),
            u=body.u,
            transcript_id=parsed.transcript_id or body.transcript_id,
        )
        acc = parse_lunp_text(result.lunp_text, parsed.sequence)
        located = find_target_matches(parsed.sequence, candidate)
        matches = located["matches"] or located["reverse_complement_matches"]
        if not matches:
            raise ValueError("That candidate sequence was not found in the transcript.")
        hit = matches[0]
        region = extract_target_accessibility(acc, hit.start, hit.end)
        summary = calculate_accessibility_summary(region)
        windows = find_best_windows_for_target(
            acc, hit.start, hit.end, parsed.sequence
        )
        profile = [
            None if pd.isna(v) else float(v) for v in acc["unpaired_l1"].tolist()
        ]
        return {
            "transcript_id": parsed.transcript_id,
            "transcript_length": parsed.length,
            "version": result.version,
            "match": {
                "start": hit.start,
                "end": hit.end,
                "strand": hit.strand,
                "length": hit.length,
            },
            "summary": summary,
            "windows": {
                str(k): None
                if v is None
                else {
                    "start": v.start,
                    "end": v.end,
                    "probability": v.probability,
                    "sequence": v.sequence,
                }
                for k, v in windows.items()
            },
            "profile": _downsample(profile),
        }
    except (FastaError, RNAplfoldError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/accessibility/fragment")
def accessibility_fragment(body: FragmentBody):
    from rnaplfold.analysis import find_codon_sites, fragment_codon_accessibility
    from rnaplfold.parser import parse_lunp_text
    from rnaplfold.runner import RNAplfoldError, run_rnaplfold
    from utils.fasta import FastaError, strip_display_ellipsis, validate_rna_alphabet

    try:
        fragment, _meta = strip_display_ellipsis(body.fragment)
        validate_rna_alphabet(fragment)
        n = len(fragment)
        w = body.w or n
        l = body.l or n
        result = run_rnaplfold(fragment, w=w, l=min(l, w), u=min(body.u, n))
        acc = parse_lunp_text(result.lunp_text, fragment)
        located = find_codon_sites(fragment, body.codon)
        sites = located["matches"] or located["reverse_complement_matches"]
        if not sites:
            raise ValueError("That codon was not found in the fragment.")
        if len(sites) > 1:
            raise ValueError(f"Codon found {len(sites)} times; use a unique codon.")
        exposure = fragment_codon_accessibility(acc, sites[0], flank=body.flank)
        profile = [
            None if pd.isna(v) else float(v) for v in acc["unpaired_l1"].tolist()
        ]
        return {
            "length": n,
            "version": result.version,
            "site": {"start": sites[0].start, "end": sites[0].end, "sequence": sites[0].sequence},
            "exposure": {
                k: (None if isinstance(v, float) and pd.isna(v) else v)
                for k, v in exposure.items()
                if k != "codon"
            },
            "profile": profile,
        }
    except (FastaError, RNAplfoldError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/sensor")
def sensor(body: SensorBody):
    from rnafold.runner import RNAfoldError, fold_sensor
    from utils.fasta import normalize_sequence

    try:
        result = fold_sensor(normalize_sequence(body.sequence))
    except RNAfoldError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "sequence": result.sequence,
        "mfe_structure": result.mfe_structure,
        "mfe_kcal": result.mfe_kcal,
        "ensemble_energy_kcal": result.ensemble_energy_kcal,
        "mfe_frequency": result.mfe_frequency,
        "ensemble_diversity": result.ensemble_diversity,
        "pairing_probability": list(result.pairing_probability),
        "mfe_pair_probability": list(result.mfe_pair_probability),
        "coordinates": [list(pt) for pt in result.coordinates]
        if result.coordinates is not None
        else None,
        "version": result.version,
    }


@app.post("/api/simulate")
def simulate_run(body: SimulateBody):
    # SIMULATION_STUB — replace simulation_stub.simulate with the ODE solver.
    from simulation_stub import simulate

    try:
        return simulate(body.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
