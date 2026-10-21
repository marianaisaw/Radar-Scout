"""Isoform TPM from GTEx long-read GENCODE quantification, by cell type."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

TPM_PATH = Path(__file__).resolve().parent / "quantification_gencode.tpm.txt"
SAMPLE_TISSUES_PATH = Path(__file__).resolve().parent / "sample_tissues.json"
DEFAULT_TISSUE = "Cells - Cultured fibroblasts"
TISSUE_ALIASES = {
    "kidney": DEFAULT_TISSUE,
    "kidney fibrosis": DEFAULT_TISSUE,
    "kidney - cortex": DEFAULT_TISSUE,
    "cells - cultured fibroblasts": DEFAULT_TISSUE,
}


def resolve_tissue(tissue: str | None, available: list[str] | None = None) -> str:
    """Map a requested cell type onto one present in the GTEx long-read file."""
    names = list(available) if available is not None else tissue_options()
    wanted = (tissue or "").strip()
    if wanted in names:
        return wanted
    alias = TISSUE_ALIASES.get(wanted.lower())
    if alias and alias in names:
        return alias
    lowered = {name.lower(): name for name in names}
    if wanted.lower() in lowered:
        return lowered[wanted.lower()]
    if DEFAULT_TISSUE in names:
        return DEFAULT_TISSUE
    return names[0] if names else DEFAULT_TISSUE


def core_transcript_id(transcript_id: str) -> str:
    """Strip the Ensembl version so Gao and GENCODE IDs can be matched."""
    return str(transcript_id).split(".")[0]


def load_sample_tissues(path: Path | None = None) -> pd.DataFrame:
    path = path or SAMPLE_TISSUES_PATH
    rows = json.loads(path.read_text())
    return pd.DataFrame(rows)


def tissue_options(sample_tissues: pd.DataFrame | None = None) -> list[str]:
    """Cell types present in the long-read file, fibroblasts first."""
    meta = sample_tissues if sample_tissues is not None else load_sample_tissues()
    names = sorted(meta.loc[meta["use_for_mean"], "tissue"].unique())
    if DEFAULT_TISSUE in names:
        names.remove(DEFAULT_TISSUE)
        return [DEFAULT_TISSUE, *names]
    return names


def samples_for_tissue(
    tissue: str,
    sample_tissues: pd.DataFrame | None = None,
) -> list[str]:
    meta = sample_tissues if sample_tissues is not None else load_sample_tissues()
    chosen = meta[(meta["tissue"] == tissue) & (meta["use_for_mean"])]
    return chosen["sample"].tolist()


def load_tissue_mean_tpm(
    path: Path | None = None,
    sample_tissues: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, dict[str, int]]:
    """
    Mean TPM per cell type.

    Returns a table indexed by versionless ENST ID (column gencode_id plus
    one column per tissue) and a map of tissue -> sample count.
    """
    path = path or TPM_PATH
    meta = sample_tissues if sample_tissues is not None else load_sample_tissues()
    used = meta[meta["use_for_mean"]]
    samples = used["sample"].tolist()
    df = pd.read_csv(path, sep="\t", usecols=["transcript", *samples])
    core_ids = df["transcript"].map(core_transcript_id)
    means = {"gencode_id": df["transcript"].to_numpy()}
    counts: dict[str, int] = {}
    for tissue, group in used.groupby("tissue", sort=False):
        cols = group["sample"].tolist()
        means[tissue] = df[cols].mean(axis=1).to_numpy()
        counts[str(tissue)] = len(cols)
    out = pd.DataFrame(means, index=core_ids)
    out = out[~out.index.duplicated(keep="first")]
    return out, counts


def isoform_expression_table(
    isoform_ids: list[str],
    tpm_index: pd.DataFrame,
    tissue: str,
) -> pd.DataFrame:
    """Gao isoforms present in this cell type (TPM > 0), ranked by abundance."""
    if tissue not in tpm_index.columns:
        return pd.DataFrame(columns=["Transcript", "TPM", "Rel. %"])
    rows = []
    for isoform_id in isoform_ids:
        core = core_transcript_id(isoform_id)
        if core in tpm_index.index:
            tpm = float(tpm_index.loc[core, tissue])
        else:
            tpm = 0.0
        rows.append({"Transcript": isoform_id, "TPM": tpm})
    table = pd.DataFrame(rows)
    if table.empty:
        return table.assign(**{"Rel. %": pd.Series(dtype=float)})
    expressed = table[table["TPM"] > 0].copy()
    total = float(expressed["TPM"].sum()) if not expressed.empty else 0.0
    if total > 0:
        expressed["Rel. %"] = 100.0 * expressed["TPM"] / total
    else:
        expressed["Rel. %"] = 0.0
    return expressed.sort_values("TPM", ascending=False).reset_index(drop=True)
