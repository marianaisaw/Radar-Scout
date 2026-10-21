"""Horizontal stacked bars of Gao isoform abundance in cultured fibroblasts."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.patches import FancyBboxPatch

from isoformSearch.tpm import DEFAULT_TISSUE, core_transcript_id, load_tissue_mean_tpm

REPO = Path(__file__).resolve().parents[1]
DB_PATH = REPO / "radar_candidates.db"
OUT_DIR = Path(__file__).resolve().parent
GENES = ["COL11A1", "SFRP4", "ADAM12", "POSTN", "SPP1", "ASPN"]

# One unique color per expressed isoform in the figure (tab20).
ISO_COLORS = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
    "#393b79",
    "#637939",
    "#8c6d31",
    "#843c39",
    "#7b4173",
    "#3182bd",
    "#e6550d",
    "#31a354",
    "#756bb1",
    "#636363",
]


def gao_isoform_ids(gene: str) -> list[str]:
    conn = sqlite3.connect(f"file:{DB_PATH.resolve()}?mode=ro&immutable=1", uri=True)
    try:
        rows = conn.execute(
            "SELECT DISTINCT matches FROM candidates WHERE gene=?",
            (gene,),
        ).fetchall()
    finally:
        conn.close()
    ids: set[str] = set()
    for (matches,) in rows:
        if not matches:
            continue
        for part in str(matches).split(";"):
            part = part.strip()
            if part:
                ids.add(part)
    return sorted(ids)


def gene_isoform_table(gene: str, tpm_index: pd.DataFrame, tissue: str) -> pd.DataFrame:
    """Every Gao isoform for the gene, with fibroblast TPM and relative %."""
    ids = gao_isoform_ids(gene)
    rows = []
    for isoform_id in ids:
        core = core_transcript_id(isoform_id)
        in_file = core in tpm_index.index
        tpm = float(tpm_index.loc[core, tissue]) if in_file else float("nan")
        rows.append(
            {
                "gene": gene,
                "transcript": isoform_id,
                "in_gencode_file": in_file,
                "tpm": tpm,
            }
        )
    table = pd.DataFrame(rows)
    table = table.sort_values(
        ["tpm"],
        ascending=False,
        na_position="last",
    ).reset_index(drop=True)
    expressed = table["tpm"].fillna(0) > 0
    total = float(table.loc[expressed, "tpm"].sum())
    table["rel_pct"] = 0.0
    if total > 0:
        table.loc[expressed, "rel_pct"] = 100.0 * table.loc[expressed, "tpm"] / total
    table["iso_rank"] = 0
    n_expressed = int(expressed.sum())
    if n_expressed:
        table.loc[expressed, "iso_rank"] = list(range(1, n_expressed + 1))
    return table


def _assign_colors(tables: dict[str, pd.DataFrame]) -> dict[tuple[str, str], str]:
    colors: dict[tuple[str, str], str] = {}
    i = 0
    for gene in GENES:
        expressed = tables[gene][tables[gene]["rel_pct"] > 0]
        for transcript in expressed["transcript"]:
            colors[(gene, transcript)] = ISO_COLORS[i % len(ISO_COLORS)]
            i += 1
    return colors


def plot_stacked_abundance(tables: dict[str, pd.DataFrame], tissue: str, out_png: Path) -> None:
    colors = _assign_colors(tables)
    n_genes = len(GENES)
    heights = []
    for gene in GENES:
        n_iso = int((tables[gene]["rel_pct"] > 0).sum())
        heights.append(max(1.15, 0.38 * n_iso + 0.55))

    fig = plt.figure(figsize=(15.2, sum(heights) + 1.35))
    gs = fig.add_gridspec(
        n_genes,
        2,
        width_ratios=[1.15, 1.22],
        height_ratios=heights,
        hspace=0.42,
        wspace=0.06,
        left=0.09,
        right=0.98,
        top=0.90,
        bottom=0.06,
    )
    fig.suptitle(
        "Which isoforms are present in cultured fibroblasts?\n"
        f"GTEx long-read RNA-seq  ·  mean TPM  ·  {tissue}",
        fontsize=14,
        fontweight="bold",
        y=0.98,
    )

    bar_axes = []
    for row, gene in enumerate(GENES):
        ax_bar = fig.add_subplot(gs[row, 0])
        ax_key = fig.add_subplot(gs[row, 1])
        bar_axes.append(ax_bar)

        table = tables[gene]
        expressed = table[table["rel_pct"] > 0].copy()
        total_tpm = float(expressed["tpm"].sum()) if not expressed.empty else 0.0

        ax_bar.set_xlim(0, 100)
        ax_bar.set_ylim(0, 1)
        ax_bar.set_yticks([])
        ax_bar.spines[["top", "right", "left"]].set_visible(False)
        ax_bar.tick_params(axis="x", labelsize=8)
        if row < n_genes - 1:
            ax_bar.set_xticklabels([])
        ax_bar.set_ylabel(
            f"{gene}\n{total_tpm:.1f} TPM",
            rotation=0,
            ha="right",
            va="center",
            fontsize=11,
            fontweight="bold",
            labelpad=14,
        )

        left = 0.0
        for _, iso in expressed.iterrows():
            width = float(iso["rel_pct"])
            color = colors[(gene, iso["transcript"])]
            ax_bar.barh(
                0.5,
                width,
                left=left,
                height=0.55,
                color=color,
                edgecolor="white",
                linewidth=1.0,
                align="center",
            )
            if width >= 9:
                ax_bar.text(
                    left + width / 2,
                    0.5,
                    f"{width:.0f}%",
                    ha="center",
                    va="center",
                    color="white",
                    fontsize=9,
                    fontweight="bold",
                )
            left += width

        ax_key.set_xlim(0, 1)
        ax_key.set_ylim(0, 1)
        ax_key.axis("off")
        ax_key.set_title("Isoform key", fontsize=8, loc="left", color="#555555", pad=2)

        n = max(len(expressed), 1)
        for i, iso in enumerate(expressed.itertuples()):
            y = 1.0 - (i + 0.5) / n
            color = colors[(gene, iso.transcript)]
            ax_key.add_patch(
                FancyBboxPatch(
                    (0.01, y - 0.32 / n),
                    0.045,
                    0.52 / n,
                    boxstyle="round,pad=0.004,rounding_size=0.008",
                    facecolor=color,
                    edgecolor="none",
                    transform=ax_key.transAxes,
                    clip_on=False,
                )
            )
            ax_key.text(
                0.08,
                y,
                iso.transcript,
                ha="left",
                va="center",
                fontsize=9,
                fontfamily="monospace",
                fontweight="normal",
                color="#111111",
                transform=ax_key.transAxes,
                clip_on=False,
            )
            ax_key.text(
                0.70,
                y,
                f"{iso.rel_pct:5.1f}%",
                ha="left",
                va="center",
                fontsize=9,
                fontweight="bold",
                color=color,
                transform=ax_key.transAxes,
            )
            ax_key.text(
                0.84,
                y,
                f"{iso.tpm:.2f} TPM",
                ha="left",
                va="center",
                fontsize=8.6,
                color="#333333",
                transform=ax_key.transAxes,
            )

        if expressed.empty:
            ax_bar.text(50, 0.5, "no isoform with TPM > 0", ha="center", va="center")
            ax_key.text(0.05, 0.5, "none detected", ha="left", va="center", color="#777777")

    bar_axes[-1].set_xlabel(
        "Relative abundance among expressed isoforms (%)",
        fontsize=10,
    )
    fig.savefig(out_png, dpi=220)
    fig.savefig(out_png.with_suffix(".pdf"))
    plt.close(fig)


def main() -> None:
    tpm_index, _counts = load_tissue_mean_tpm()
    tables = {
        gene: gene_isoform_table(gene, tpm_index, DEFAULT_TISSUE) for gene in GENES
    }
    combined = pd.concat(tables.values(), ignore_index=True)
    csv_path = OUT_DIR / "stacked_isoform_expression.csv"
    combined.to_csv(csv_path, index=False)

    print(combined[combined["rel_pct"] > 0].to_string(index=False))
    png_path = OUT_DIR / "stacked_isoform_expression.png"
    plot_stacked_abundance(tables, DEFAULT_TISSUE, png_path)
    print(f"\nWrote {csv_path}")
    print(f"Wrote {png_path}")
    print(f"Wrote {png_path.with_suffix('.pdf')}")


if __name__ == "__main__":
    main()
