"""Assemble per-disease dashboard data from the Modal-scored outputs.

Reads outputs/manifest.json + each <name>_racs.parquet / _umap.parquet / _meta.json
and writes compact JSON into dashboard/public/data/ for the multi-disease dashboard:
  - diseases.json                 : the disease/cohort switcher manifest
  - <name>_racs.json              : ranked gene table (top N, all metrics + DSS)
  - <name>_umap.json              : subsampled UMAP points
  - cross_cohort.json             : keloid cross-cohort consensus (if available)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # make radar_scout importable

OUT = Path("outputs")
DASH = Path("dashboard/public/data")
DASH.mkdir(parents=True, exist_ok=True)
TOP_N = 600
VOLCANO_MAX = 3500   # SVG point budget for the volcano (keeps the browser responsive)


def add_dss(df):
    if "DSS" not in df.columns and {"log2FC", "mean_P"}.issubset(df.columns):
        df["DSS"] = df["log2FC"].clip(lower=0) * np.log10(df["mean_P"].clip(lower=0) + 1)
    return df


def _source_label(meta):
    """Human-readable provenance for a cohort pill (GEO accession vs CELLxGENE)."""
    src = str(meta.get("source", "") or "")
    if src.upper().startswith("GSE"):
        return f"GEO {src.upper()}"
    if "cellxgene" in src.lower():
        return "CELLxGENE"
    if meta.get("census_version"):
        return "CELLxGENE Census"
    return "CELLxGENE"


def _comparison(meta, disease, cell_type):
    """Spell out EXACTLY which two groups the fold-change contrasts.

    P is always the pathogenic cell type inside diseased tissue. The reference is
    the same cell type in healthy donors (`H`) when that exists; otherwise the
    other ("bystander") cell types of the diseased tissue (`B`).
    """
    cc = meta.get("cell_counts") or {}
    nd = meta.get("n_donors") or {}
    ref = str(meta.get("reference_pop") or "H")
    ref_pop = "H" if ref.startswith("H") else "B"
    ct = (cell_type or "fibroblast").split(",")[0].strip()
    if ref_pop == "H":
        ref_label = f"{ct} from healthy / control donors"
        ref_kind = "healthy"
    else:
        ref_label = f"other cell types in the same diseased tissue (no healthy arm)"
        ref_kind = "bystander"
    return {
        "p_label": f"{ct} from {disease} tissue",
        "p_cells": int(cc.get("P", 0) or 0), "p_donors": int(nd.get("P", 0) or 0),
        "ref_pop": ref_pop, "ref_kind": ref_kind, "ref_label": ref_label,
        "ref_cells": int(cc.get(ref_pop, 0) or 0), "ref_donors": int(nd.get(ref_pop, 0) or 0),
        "cell_type": ct, "source": str(meta.get("source") or ""),
    }


def emit_disease(name, disease, cell_type, cohort=None):
    p = OUT / f"{name}_racs.parquet"
    if not p.exists():
        print(f"  [skip {name}] no racs parquet")
        return None
    df = add_dss(pd.read_parquet(p))
    df = df[df["RACS"].notna()].sort_values("RACS", ascending=False)
    fl = df.select_dtypes("float").columns
    df[fl] = df[fl].round(4)
    df.head(TOP_N).to_json(DASH / f"{name}_racs.json", orient="records")

    has_umap = (OUT / f"{name}_umap.parquet").exists()
    if has_umap:
        ud = pd.read_parquet(OUT / f"{name}_umap.parquet")
        f2 = ud.select_dtypes("float").columns
        ud[f2] = ud[f2].round(3)
        ud.to_json(DASH / f"{name}_umap.json", orient="records")

    meta = {}
    if (OUT / f"{name}_meta.json").exists():
        meta = json.load(open(OUT / f"{name}_meta.json"))
    cohort = cohort or _source_label(meta)
    return {"key": name, "disease": disease, "cell_type": cell_type, "cohort": cohort,
            "comparison": _comparison(meta, disease, cell_type),
            "n_genes": int(len(df)), "n_donors": meta.get("n_donors", {}),
            "reference_pop": meta.get("reference_pop"), "has_umap": has_umap,
            "subpop": meta.get("subpop", {})}


POOL_METRICS = ["RACS", "DSS", "spec_score", "Sep", "Feas", "Repro", "OffMax", "log2FC",
                "detect_P", "detect_H", "mean_P", "act_P", "act_H", "act_B", "act_R",
                "k_op", "Youden_J", "p_value", "FDR", "celltype_spec", "delta_detect"]


def _ensure_metrics(df):
    """Add spec_score (detection specificity) + DSS if a cohort predates them."""
    df = df.copy()
    if "spec_score" not in df.columns and {"log2FC", "detect_P", "detect_H"}.issubset(df.columns):
        df["spec_score"] = (df["log2FC"].clip(lower=0)
                            * (df["detect_P"] - df["detect_H"]).clip(lower=0) / 100.0)
    if "DSS" not in df.columns and {"log2FC", "mean_P"}.issubset(df.columns):
        df["DSS"] = df["log2FC"].clip(lower=0) * np.log10(df["mean_P"].clip(lower=0) + 1)
    return df


def pool_cohorts(keys, target_priority=("spec_score", "DSS", "RACS")):
    """Pool a disease's cohorts into one consensus target ranking.

    Each cohort ranks genes by the best available sensor-target metric; genes are
    scored by mean percentile across cohorts (weighted up for appearing in more
    cohorts), so robust markers (POSTN/ADAM12 across keloid cohorts) rise to the top.
    Avoids naive cell-pooling (which would reintroduce batch) by pooling *rankings*.
    """
    tables = {}
    for k in keys:
        p = OUT / f"{k}_racs.parquet"
        if not p.exists():
            continue
        df = _ensure_metrics(pd.read_parquet(p))
        m = next((x for x in target_priority if x in df.columns and df[x].notna().any()), "RACS")
        d = df[df[m].notna()].copy()
        # dedupe gene symbols (keep the best-scoring row) so .loc returns scalars
        d = d.sort_values(m, ascending=False).drop_duplicates(subset="gene", keep="first")
        d["_pct"] = d[m].rank(pct=True) * 100.0
        tables[k] = d.set_index("gene")
    if not tables:
        return None
    n_total = len(tables)
    genes = set().union(*[set(t.index) for t in tables.values()])
    rows = []
    for g in genes:
        pcts = {k: float(t.loc[g, "_pct"]) for k, t in tables.items() if g in t.index}
        ncoh = len(pcts)
        cons = float(np.mean(list(pcts.values())))
        rec = {"gene": g, "pooled_score": round(cons * (0.5 + 0.5 * ncoh / n_total), 2),
               "consensus_pct": round(cons, 1), "n_cohorts": ncoh,
               "per_cohort": {k: round(v, 1) for k, v in pcts.items()}}
        for c in POOL_METRICS:
            vals = [float(t.loc[g, c]) for k, t in tables.items()
                    if g in t.index and c in t.columns and pd.notna(t.loc[g, c])]
            if vals:
                rec[c] = round(float(np.mean(vals)), 4)
        rows.append(rec)
    out = pd.DataFrame(rows)
    from radar_scout.genesets import filter_technical  # drop unannotated / technical
    out = out[filter_technical(out["gene"].to_numpy())]
    return out.sort_values("pooled_score", ascending=False).reset_index(drop=True)


def main():
    diseases = []
    seen = set()
    if (OUT / "manifest.json").exists():
        for d in json.load(open(OUT / "manifest.json"))["diseases"]:
            ent = emit_disease(d["out_name"], d["disease"], d.get("cell_type"))
            if ent:
                diseases.append(ent)
                seen.add(d["out_name"])
    # extra cohorts not in the census manifest (GEO + the Deng MFB sensor ranking)
    for name, dis, ct, coh in [
        ("keloid_geo", "keloid", "skin fibroblast", "GEO GSE163973"),
        ("keloid_deng_mfb", "keloid", "pathological MFB (Deng C3)", "Deng MFB vs normal scar"),
    ]:
        if name not in seen and (OUT / f"{name}_racs.parquet").exists():
            ent = emit_disease(name, dis, ct, cohort=coh)
            if ent:
                diseases.append(ent)

    # ---- one POOLED target ranking per disease (consensus across its cohorts) ----
    # keloid_v2: weak whole-fibroblast run, superseded.
    # melanoma_*: not a fibrosis — the portal is strictly organ fibrosis. The scored
    # parquet is kept in outputs/ so it can be restored by deleting it from this set.
    EXCLUDE = {"keloid_v2", "melanoma_malignant", "melanoma_7b20c613", "melanoma_b617ee1b"}
    entries = [e for e in diseases if e["key"] not in EXCLUDE]
    grouped: dict = {}
    for e in entries:
        grouped.setdefault(e["disease"], []).append(e)

    out = []
    for dis in sorted(grouped):
        cohorts = grouped[dis]
        pooled = pool_cohorts([c["key"] for c in cohorts])
        dkey = dis.replace(" ", "_") + "_pooled"
        n_genes = 0
        if pooled is not None:
            fl = pooled.select_dtypes("float").columns
            pooled[fl] = pooled[fl].round(4)
            pooled.head(TOP_N).to_json(DASH / f"{dkey}_racs.json", orient="records")
            n_genes = int(len(pooled))
            # Volcano needs the WHOLE distribution — the top-N table is up-regulated by
            # construction, so on its own the down-regulated half of the plot is empty.
            ycol = "FDR" if "FDR" in pooled.columns else ("p_value" if "p_value" in pooled.columns else None)
            if "log2FC" in pooled.columns and ycol:
                v = pooled[["gene", "log2FC", ycol]].dropna().rename(columns={ycol: "y_raw"})
                # Keep every informative gene (significant or strongly changed, either
                # direction) and subsample the dense middle — ~10k SVG points stalls the
                # browser, and the cloud near zero carries no information anyway.
                keep = v[(v["y_raw"] < 0.05) | (v["log2FC"].abs() > 0.5)]
                rest = v.drop(keep.index)
                budget = max(0, VOLCANO_MAX - len(keep))
                if len(rest) > budget:
                    rest = rest.sample(n=budget, random_state=0)
                v = pd.concat([keep, rest]).sort_values("log2FC")
                v["y_field"] = ycol
                v.round(4).to_json(DASH / f"{dkey}_volcano.json", orient="records")
        umap_key = next((c["key"] for c in cohorts if c.get("has_umap")), None)
        nd: dict = {}  # merge donor counts across cohorts (max per population)
        for c in cohorts:
            for k, v in (c.get("n_donors") or {}).items():
                nd[k] = max(nd.get(k, 0), int(v) if v else 0)
        out.append({"disease": dis, "key": dkey, "n_genes": n_genes,
                    "n_cohorts": len(cohorts), "n_donors": nd, "umap_key": umap_key,
                    "has_umap": umap_key is not None,
                    "cohorts": [{"key": c["key"], "cohort": c.get("cohort") or c["key"],
                                 "cell_type": c.get("cell_type"),
                                 "comparison": c.get("comparison")} for c in cohorts]})
    json.dump({"diseases": out}, open(DASH / "diseases.json", "w"), indent=2)

    cc = OUT / "cross_cohort_DSS.csv"
    if cc.exists():
        pd.read_csv(cc).head(40).round(1).to_json(DASH / "cross_cohort.json", orient="records")

    print("pooled diseases:", [f"{d['disease']} ({d['n_cohorts']} cohorts -> {d['n_genes']} genes)" for d in out])


if __name__ == "__main__":
    main()
