"""Modal app: pull single-cell data from the CELLxGENE Census and score targets.

Heavy single-cell work runs here (per the project's Modal-first policy), not
locally. Two entrypoints:

  * ``census_disease_scan`` — CHEAP smoke test. Reads only the Census's
    precomputed summary-cell-counts table (tiny) to report which skin/scar/
    fibrosis diseases and how many cells are actually available. Run this first;
    it tells us whether keloid is in the Census or whether we fall back to a GEO
    loader / a related fibrosis for the first vertical.

  * ``build_and_score`` — pulls per-cell expression for the pathogenic (P),
    healthy (H), bystander (B), and related-disease (R) populations, normalizes
    to CP10k, and runs the donor-aware RACS scorer, writing a ranked table to a
    Modal Volume.

Usage:
    modal run modal_app/census_pull.py                 # smoke test (scan)
    modal run modal_app/census_pull.py::build_and_score --disease keloid ...
"""

from __future__ import annotations

import json

import modal

app = modal.App("radar-scout")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        # must be recent enough to read the current Census SOMA encoding (>=1.1.0);
        # pulls a compatible tiledbsoma. Older pins fail with "Unsupported SOMA
        # object encoding version".
        "cellxgene-census==1.18.0",
        "scanpy",
        "leidenalg",
        "igraph",
        "harmonypy",   # batch correction
        "scikit-image",  # scrublet dep
        "pyarrow",
    )
    # ship the scoring package so RACS runs on Modal
    .add_local_dir("radar_scout", remote_path="/root/radar_scout")
)

vol = modal.Volume.from_name("radar-scout-data", create_if_missing=True)
DATA = "/data"

CENSUS_VERSION = "2025-11-08"  # pinned LTS for reproducibility (was "stable" on 2026-07-08)

# Terms we care about for the keloid / fibrosis first vertical. Extended via CLI.
SCAN_PATTERNS = ["keloid", "scar", "fibro", "sclerosis", "dermat", "skin", "wound", "cheloid"]


@app.function(image=image, timeout=900)
def census_disease_scan(patterns: list[str] | None = None) -> dict:
    """Report available diseases (cell counts) matching patterns. Cheap.

    Schema-robust: the summary_cell_counts column names vary across Census
    versions, so we detect the organism/category/label/count columns dynamically
    and echo the real column list.
    """
    import cellxgene_census

    patterns = [p.lower() for p in (patterns or SCAN_PATTERNS)]
    with cellxgene_census.open_soma(census_version=CENSUS_VERSION) as census:
        sccc = census["census_info"]["summary_cell_counts"].read().concat().to_pandas()

    print("SCCC COLUMNS:", list(sccc.columns), "| SHAPE", sccc.shape)
    lc = {c.lower(): c for c in sccc.columns}

    def col(*cands):
        for c in cands:
            if c in lc:
                return lc[c]
        return None

    org_c = col("organism")
    cat_c = col("category")
    lab_c = col("label", "ontology_term_label", "ontology_term_id")
    cnt_c = col("total_cell_count", "unique_cell_count", "n_cells", "count")

    # probe the actual vocabulary (varies across Census versions)
    print("CATEGORIES:", sorted(sccc[cat_c].astype(str).unique())[:30] if cat_c else None)
    print("ORGANISMS:", sorted(sccc[org_c].astype(str).unique())[:10] if org_c else None)

    diseases = sccc[sccc[cat_c].astype(str).str.lower() == "disease"].copy() if cat_c else sccc.copy()
    if org_c is not None and diseases.shape[0]:
        org_vals = diseases[org_c].astype(str)
        mask = org_vals.str.contains("sapiens", case=False, na=False) | org_vals.str.contains("9606", na=False)
        if mask.any():
            diseases = diseases[mask].copy()
    diseases["_label_l"] = diseases[lab_c].astype(str).str.lower()
    hit = diseases[diseases["_label_l"].apply(lambda s: any(p in s for p in patterns))]
    have_cnt = cnt_c is not None and cnt_c in hit.columns
    if have_cnt:
        hit = hit.sort_values(cnt_c, ascending=False)

    out = {
        "census_version": CENSUS_VERSION,
        "columns": list(sccc.columns),
        "count_col": cnt_c,
        "n_disease_terms": int(diseases.shape[0]),
        "matched_diseases": [
            {"disease": r[lab_c], "cells": int(r[cnt_c]) if have_cnt else None}
            for _, r in hit.iterrows()
        ],
    }
    print(json.dumps(out, indent=2))
    return out


@app.function(image=image, timeout=900)
def population_probe(disease: str = "keloid", cell_types: str = "fibroblast",
                     tissue: str = "skin", related: str = "") -> dict:
    """Metadata-only donor/cell/dataset counts for P and H (and related diseases).

    Cheap (reads obs columns only, no expression). Answers the critical question:
    does this disease have enough biological donors for donor-aware statistics?

    ``cell_types`` and ``related`` are comma-separated (Modal CLI can't parse list
    annotations). e.g. --cell-types "fibroblast,myofibroblast" --related "cystic fibrosis".
    """
    import cellxgene_census

    cts = [c.strip() for c in cell_types.split(",") if c.strip()]
    related_list = [r.strip() for r in related.split(",") if r.strip()]
    ct_in = "[" + ", ".join(f"'{c}'" for c in cts) + "]"
    cols = ["donor_id", "cell_type", "disease", "tissue_general", "assay", "dataset_id"]

    def summarize(df, name):
        return {
            "population": name, "n_cells": int(len(df)),
            "n_donors": int(df["donor_id"].nunique()) if len(df) else 0,
            "n_datasets": int(df["dataset_id"].nunique()) if len(df) else 0,
            "assays": sorted(df["assay"].astype(str).unique())[:6] if len(df) else [],
            "cells_per_donor": (df.groupby("donor_id").size().describe()[["min", "50%", "max"]]
                                .astype(int).to_dict() if len(df) else {}),
        }

    with cellxgene_census.open_soma(census_version=CENSUS_VERSION) as census:
        obs = census["census_data"]["homo_sapiens"].obs

        def q(vf):
            return obs.read(value_filter=vf, column_names=cols).concat().to_pandas()

        out = {"disease": disease, "cell_types": cts, "tissue": tissue, "populations": []}
        out["populations"].append(summarize(
            q(f"disease == '{disease}' and cell_type in {ct_in} and tissue_general == '{tissue}'"), "P (pathogenic)"))
        out["populations"].append(summarize(
            q(f"disease == 'normal' and cell_type in {ct_in} and tissue_general == '{tissue}'"), "H (healthy)"))
        for rd in related_list:
            out["populations"].append(summarize(
                q(f"disease == '{rd}' and cell_type in {ct_in}"), f"R: {rd}"))

    print(json.dumps(out, indent=2))
    return out


@app.function(image=image, timeout=900)
def disease_composition(disease: str = "keloid", tissue: str = "") -> dict:
    """Dump the ACTUAL cell_type / tissue labels used for a disease (no expression).

    Reveals the real annotation vocabulary so we can build correct filters (the
    generic 'fibroblast' CL term often isn't what datasets use)."""
    import cellxgene_census

    with cellxgene_census.open_soma(census_version=CENSUS_VERSION) as census:
        obs = census["census_data"]["homo_sapiens"].obs
        vf = f"disease == '{disease}'"
        if tissue:
            vf += f" and tissue_general == '{tissue}'"
        df = obs.read(
            value_filter=vf,
            column_names=["donor_id", "cell_type", "tissue_general", "tissue", "assay", "dataset_id"],
        ).concat().to_pandas()

    out = {
        "disease": disease,
        "n_cells": int(len(df)),
        "n_donors": int(df["donor_id"].nunique()) if len(df) else 0,
        "n_datasets": int(df["dataset_id"].nunique()) if len(df) else 0,
        "tissue_general": {k: int(v) for k, v in df["tissue_general"].value_counts().head(10).items()},
        "cell_types": {k: int(v) for k, v in df["cell_type"].value_counts().head(30).items()},
    }
    print(json.dumps(out, indent=2))
    return out


@app.function(image=image, timeout=900)
def celltype_across_disease(cell_type: str = "skin fibroblast", tissue: str = "") -> dict:
    """Per-disease cell/donor/dataset counts for a given cell type. Gives P, H, and
    the candidate R (related-disease) set in one shot."""
    import cellxgene_census

    with cellxgene_census.open_soma(census_version=CENSUS_VERSION) as census:
        obs = census["census_data"]["homo_sapiens"].obs
        vf = f"cell_type == '{cell_type}'"
        if tissue:
            vf += f" and tissue_general == '{tissue}'"
        df = obs.read(
            value_filter=vf,
            column_names=["donor_id", "disease", "tissue_general", "dataset_id"],
        ).concat().to_pandas()

    g = (df.groupby("disease")
         .agg(n_cells=("donor_id", "size"), n_donors=("donor_id", "nunique"),
              n_datasets=("dataset_id", "nunique"))
         .sort_values("n_cells", ascending=False))
    g = g[g["n_cells"] > 0]
    out = {"cell_type": cell_type, "total_cells": int(len(df)),
           "by_disease": [{"disease": d, "n_cells": int(r.n_cells),
                           "n_donors": int(r.n_donors), "n_datasets": int(r.n_datasets)}
                          for d, r in g.head(40).iterrows()]}
    print(json.dumps(out, indent=2))
    return out


def _fetch_pop(census, obs_filter, label, max_cells, rng):
    """Fetch one population as AnnData, tag it, subsample to max_cells.

    Robust: returns None on filter error (e.g. unsupported 'not in') or empty result.
    """
    import cellxgene_census
    import numpy as np

    try:
        adata = cellxgene_census.get_anndata(
            census, organism="Homo sapiens", obs_value_filter=obs_filter,
            obs_column_names=["donor_id", "cell_type", "disease", "tissue_general", "assay"],
        )
    except Exception as e:
        print(f"[skip {label}] {type(e).__name__}: {e}")
        return None
    if adata.n_obs == 0:
        print(f"[empty {label}]")
        return None
    if adata.n_obs > max_cells:
        idx = np.sort(rng.choice(adata.n_obs, size=max_cells, replace=False))
        adata = adata[idx].copy()
    adata.obs["radar_pop"] = label
    print(f"[{label}] {adata.n_obs} cells, {adata.obs['donor_id'].nunique()} donors")
    return adata


def _save_paga(lg, pop, path):
    """Save the PAGA graph (cluster connectivities + UMAP centroids + population mix)."""
    import json

    import numpy as np
    import pandas as pd

    conn = lg.uns["paga"]["connectivities"]
    conn = conn.toarray() if hasattr(conn, "toarray") else np.asarray(conn)
    clusters = lg.obs["leiden"].to_numpy()
    cats = list(lg.obs["leiden"].cat.categories)
    xy = lg.obsm["X_umap"]
    nodes = [{"cluster": str(c), "x": float(xy[clusters == c, 0].mean()),
              "y": float(xy[clusters == c, 1].mean()), "n": int((clusters == c).sum()),
              "pop": {k: round(float(v), 2) for k, v in
                      pd.Series(pop[clusters == c]).value_counts(normalize=True).items()}}
             for c in cats]
    edges = [{"a": str(cats[i]), "b": str(cats[j]), "w": round(float(conn[i, j]), 3)}
             for i in range(len(cats)) for j in range(i + 1, len(cats)) if conn[i, j] > 0.05]
    json.dump({"nodes": nodes, "edges": edges}, open(path, "w"))


@app.function(image=image, volumes={DATA: vol}, timeout=7200, memory=65536, cpu=8.0)
def build_and_score(
    disease: str = "melanoma",
    pathogenic_cell_types: str = "malignant cell",
    related_diseases: str = "",
    tissue: str = "",
    min_detect_frac: float = 0.10,
    max_cells_per_pop: int = 40000,
    exclude_technical: bool = True,
    compute_umap: bool = True,
    subcluster: bool = False,
    subcluster_resolution: float = 1.0,
    out_name: str = "",
) -> dict:
    """Disease-agnostic RADAR target prioritization on the CELLxGENE Census.

    Pulls the whole diseased tissue and splits it into pathogenic P (cell types
    matching ``pathogenic_cell_types``) vs bystander B (all other cell types ->
    cell-type specificity), plus healthy counterpart H (same cell types in 'normal')
    and related-disease R. Computes the full RACS metric table, a UMAP, and
    donor-level DE; writes everything to the Volume and updates a dashboard manifest.
    """
    import cellxgene_census
    import numpy as np
    import pandas as pd
    import scanpy as sc
    import anndata as ad

    from radar_scout.scoring import score_matrix
    from radar_scout.genesets import filter_technical
    from radar_scout.de import pseudobulk_de

    pct = [c.strip().lower() for c in pathogenic_cell_types.split(",") if c.strip()]
    related = [r.strip() for r in related_diseases.split(",") if r.strip()]
    out_name = out_name or disease.replace(" ", "_")
    tis = f" and tissue_general == '{tissue}'" if tissue else ""
    rng = np.random.default_rng(0)

    with cellxgene_census.open_soma(census_version=CENSUS_VERSION) as census:
        # resolve the target cell-type labels actually present for this disease (cheap obs read),
        # so the pathogenic population is fetched directly and is well-sampled even when it is
        # a minority of the tissue (e.g. fibroblasts in lung).
        obs = census["census_data"]["homo_sapiens"].obs
        avail = obs.read(value_filter=f"disease == '{disease}'{tis}",
                         column_names=["cell_type"]).concat().to_pandas()["cell_type"].astype(str)
        uniq = sorted(avail.unique())
        # exact match, else the requested term is contained in a more specific label
        # (e.g. "fibroblast" -> "alveolar fibroblast"). Only the query-in-candidate
        # direction — the reverse wrongly matched "T cell" inside "malignan-t cell".
        resolved = [c for c in uniq if c.lower() in pct or any(t in c.lower() for t in pct)]
        if not resolved:
            raise RuntimeError(f"No cell types matched {pct}; available: {uniq[:25]}")
        lab_in = "[" + ", ".join(f"'{c}'" for c in resolved) + "]"
        p_labels = resolved
        print(f"[resolve] pathogenic cell types: {resolved}")

        # P: dedicated fetch of the target cell type in the disease (well-sampled)
        p = _fetch_pop(census, f"disease == '{disease}' and cell_type in {lab_in}{tis}",
                       "P", max_cells_per_pop, rng)
        if p is None:
            raise RuntimeError(f"No pathogenic cells for {disease} / {resolved}")
        parts = [p]
        # B: bystander cell types in the diseased tissue (cell-type specificity + UMAP context)
        b = _fetch_pop(census, f"disease == '{disease}'{tis}", "B", max_cells_per_pop, rng)
        if b is not None:
            b = b[~b.obs["cell_type"].astype(str).isin(resolved)].copy()
            if b.n_obs > 0:
                parts.append(b)
        # H: healthy counterpart (same cell types, disease == normal) — may be empty (cancer)
        parts.append(_fetch_pop(census, f"disease == 'normal' and cell_type in {lab_in}{tis}",
                                "H", max_cells_per_pop, rng))
        # R: related diseases (same cell types)
        for rd in related:
            parts.append(_fetch_pop(census, f"disease == '{rd}' and cell_type in {lab_in}",
                                    f"R::{rd}", max_cells_per_pop, rng))

    parts = [x for x in parts if x is not None and x.n_obs > 0]
    adata = ad.concat(parts, join="inner", merge="same")
    adata.obs_names_make_unique()

    # QC: doublet removal (per donor) on raw counts (spec: data harmonization)
    try:
        sc.pp.scrublet(adata, batch_key="donor_id")
        db = adata.obs.get("predicted_doublet")
        if db is not None:
            n_db = int(db.sum())
            adata = adata[~db.to_numpy()].copy()
            print(f"[qc] removed {n_db} predicted doublets")
    except Exception as e:
        print(f"[qc] scrublet skipped: {type(e).__name__}: {e}")

    adata.layers["counts"] = adata.X.copy()         # raw counts (carried for DE)
    sc.pp.normalize_total(adata, target_sum=1e4)    # linear CP10k for scoring

    pop_detail = adata.obs["radar_pop"].astype(str).to_numpy()
    pop = np.array(["R" if s.startswith("R::") else s for s in pop_detail])
    donor = adata.obs["donor_id"].astype(str).to_numpy()
    genes_all = (adata.var["feature_name"] if "feature_name" in adata.var
                 else adata.var_names).to_numpy().astype(str)

    # spec Task 4: identify the disease-enriched (pathogenic) subpopulation within the
    # target cell type and restrict P to it. This surfaces cell-STATE markers that are
    # diluted across the whole cell type (e.g. keloid mesenchymal fibroblasts:
    # POSTN/ASPN/ADAM12), mirroring how melanoma's malignant cells are already a state.
    subpop_info = {}
    if subcluster:
        mask_pt = np.isin(pop, ["P", "H"])
        subad = adata[mask_pt].copy()
        sc.pp.log1p(subad)
        sc.pp.highly_variable_genes(subad, n_top_genes=2000)
        sc.pp.pca(subad, n_comps=30)
        sc.pp.neighbors(subad, n_neighbors=15)
        try:
            sc.tl.leiden(subad, resolution=subcluster_resolution, flavor="igraph",
                         n_iterations=2, directed=False)
        except (TypeError, ImportError):
            sc.tl.leiden(subad, resolution=subcluster_resolution)
        clusters = subad.obs["leiden"].to_numpy()
        is_dis = (pop[mask_pt] == "P").astype(float)
        baseline = float(is_dis.mean())
        grp = pd.Series(is_dis).groupby(clusters)
        dfrac, csize = grp.mean(), grp.size()
        # a genuine pathogenic state must be enriched above the disease baseline AND sizeable
        elig = dfrac[(csize >= 30) & (dfrac > max(1.5 * baseline, baseline + 0.05))]
        idx_pt = np.where(mask_pt)[0]
        if len(elig):
            path_cluster = elig.idxmax()
            n_after = int(((pop[idx_pt] == "P") & (clusters == path_cluster)).sum())
            if n_after >= 20:
                reassign = idx_pt[(pop[idx_pt] == "P") & (clusters != path_cluster)]
                pop = pop.copy()
                pop[reassign] = "B"  # disease cells in non-pathogenic states -> bystander
                pop_detail = pop.copy()
                subpop_info = {"path_cluster": str(path_cluster), "disease_frac": float(dfrac[path_cluster]),
                               "baseline_frac": baseline, "n_clusters": int(csize.size), "n_P_after": n_after}
                print(f"[subpop] cluster {path_cluster}: disease_frac={dfrac[path_cluster]:.2f} "
                      f"(baseline {baseline:.2f}), P={n_after} state cells")
            else:
                print(f"[subpop] enriched cluster too small (n={n_after}); keeping whole-cell-type P")
        else:
            print(f"[subpop] no disease-enriched cluster (baseline {baseline:.2f}); keeping whole-cell-type P")

    # candidate genes: detected in >= min_detect_frac of pathogenic cells
    Xp = adata[pop == "P"].X
    detect = np.asarray((Xp > 0).mean(axis=0)).ravel()
    keep = np.where(detect >= min_detect_frac)[0]
    n_before = len(keep)
    if exclude_technical:
        m = filter_technical(genes_all[keep])
        print(f"[filter] dropped {int((~m).sum())}/{n_before} technical genes")
        keep = keep[m]

    # a single candidate-gene subset drives BOTH scoring and DE (aligned shapes)
    sub = adata[:, keep]
    genes = (sub.var["feature_name"] if "feature_name" in sub.var else sub.var_names).to_numpy().astype(str)
    Xc = np.asarray(sub.X.todense()) if hasattr(sub.X, "todense") else np.asarray(sub.X)
    df = score_matrix(Xc, genes, donor, pop, pos_label="P")

    # donor-level DE: P vs primary reference (healthy if present, else bystander)
    ref = "H" if (pop == "H").any() else "B"
    de = None
    try:
        rc = sub.layers["counts"]
        rc = np.asarray(rc.todense()) if hasattr(rc, "todense") else np.asarray(rc)
        de = pseudobulk_de(rc, donor, pop, genes, pos_label="P", neg_labels=[ref])
        de.to_parquet(f"{DATA}/{out_name}_de.parquet")
    except Exception as e:
        print(f"[de] skipped: {type(e).__name__}: {e}")

    # UMAP for the dashboard (subsampled to <=8k cells), batch-corrected + PAGA
    umap_saved = False
    if compute_umap:
        try:
            lg = adata.copy()
            sc.pp.log1p(lg)
            sc.pp.highly_variable_genes(lg, n_top_genes=2000)
            sc.pp.pca(lg, n_comps=30)
            rep = "X_pca"
            try:  # batch correction across donors (spec: data harmonization)
                sc.external.pp.harmony_integrate(lg, "donor_id")
                rep = "X_pca_harmony"
            except Exception as e:
                print(f"[umap] harmony skipped: {type(e).__name__}: {e}")
            sc.pp.neighbors(lg, n_neighbors=15, use_rep=rep)
            sc.tl.umap(lg)
            try:  # PAGA trajectory over leiden clusters
                try:
                    sc.tl.leiden(lg, resolution=1.0, flavor="igraph", n_iterations=2, directed=False)
                except (TypeError, ImportError):
                    sc.tl.leiden(lg, resolution=1.0)
                sc.tl.paga(lg, groups="leiden")
                _save_paga(lg, pop, f"{DATA}/{out_name}_paga.json")
            except Exception as e:
                print(f"[paga] skipped: {type(e).__name__}: {e}")
            xy = lg.obsm["X_umap"]
            idx = np.sort(rng.choice(lg.n_obs, size=min(lg.n_obs, 8000), replace=False))
            gpos = {g: i for i, g in enumerate(genes)}
            ud = pd.DataFrame({"UMAP1": xy[idx, 0], "UMAP2": xy[idx, 1],
                               "cell_type": lg.obs["cell_type"].astype(str).to_numpy()[idx],
                               "pop": pop[idx], "donor": donor[idx]})
            for g in df.head(12)["gene"].tolist():
                if g in gpos:
                    ud[g] = Xc[idx, gpos[g]]
            ud.to_parquet(f"{DATA}/{out_name}_umap.parquet")
            umap_saved = True
        except Exception as e:
            print(f"[umap] skipped: {type(e).__name__}: {e}")

    ucounts = sorted(set(pop_detail))
    counts = {u: int((pop_detail == u).sum()) for u in ucounts}
    ndon = {u: int(len(set(donor[pop_detail == u]))) for u in ucounts}

    df.to_parquet(f"{DATA}/{out_name}_racs.parquet")
    meta = {"disease": disease, "tissue": tissue, "pathogenic_cell_types": pct,
            "pathogenic_labels": p_labels, "related_diseases": related,
            "cell_counts": counts, "n_donors": ndon, "n_candidate_genes": int(len(genes)),
            "n_candidate_prefilter": int(n_before), "reference_pop": ref,
            "has_umap": umap_saved, "has_de": de is not None, "subpop": subpop_info,
            "census_version": CENSUS_VERSION, "top25": df.head(25).to_dict(orient="records")}
    with open(f"{DATA}/{out_name}_meta.json", "w") as fh:
        json.dump(meta, fh, indent=2, default=float)

    # update the dashboard manifest of scored diseases
    man_path = f"{DATA}/manifest.json"
    try:
        manifest = json.load(open(man_path))
    except Exception:
        manifest = {"diseases": []}
    manifest["diseases"] = [d for d in manifest["diseases"] if d.get("out_name") != out_name]
    manifest["diseases"].append({"disease": disease, "out_name": out_name,
                                 "cell_type": pathogenic_cell_types, "n_genes": int(len(genes)),
                                 "n_donors_P": ndon.get("P", 0), "reference_pop": ref,
                                 "has_umap": umap_saved})
    json.dump(manifest, open(man_path, "w"), indent=2)
    vol.commit()

    print(json.dumps({"disease": disease, "cell_counts": counts, "n_donors": ndon,
                      "n_candidate_genes": int(len(genes)), "reference": ref,
                      "umap": umap_saved, "de": de is not None}, indent=2))
    print("TOP 15 RADAR targets:")
    for r in df.head(15).to_dict("records"):
        print(f"  {str(r['gene'])[:16]:16s} RACS={r['RACS']:.3f}  Sep={r['Sep']:.3f}  "
              f"Feas={r['Feas']:.3f}  Off={r['OffMax']:.3f}  log2FC={r.get('log2FC', float('nan')):.2f}")
    return meta


@app.function(image=image, volumes={DATA: vol}, timeout=10800, memory=98304, cpu=8.0)
def build_cohorts_by_dataset(
    disease: str = "melanoma",
    pathogenic_cell_types: str = "malignant cell",
    out_prefix: str = "",
    tissue: str = "",
    min_detect_frac: float = 0.10,
    max_cells_per_pop: int = 150000,
    ref_cap: int = 40000,
    min_cells: int = 300,
    min_donors: int = 1,
    max_datasets: int = 12,
) -> dict:
    """Score EACH Census dataset of a disease as an INDEPENDENT cohort.

    build_and_score pools every Census dataset into one cohort; this splits by
    ``dataset_id`` so a disease with N datasets yields N real cross-cohort cohorts
    (each an independent published study) — the honest way to get cross-cohort
    validation without hand-parsing GEO. P = pathogenic cell type in dataset d;
    reference = healthy same-cell-type (shared, fibrosis) or same-dataset bystander
    (cancers, where 'normal malignant cell' is empty). Writes one
    ``{out_prefix}_{dataset8}_racs.parquet`` + meta per cohort and appends each to the
    dashboard manifest so build_dashboard_data pools them automatically.
    """
    import cellxgene_census
    import numpy as np
    import pandas as pd
    import scanpy as sc
    import anndata as ad

    from radar_scout.scoring import score_matrix
    from radar_scout.genesets import filter_technical

    pct = [c.strip().lower() for c in pathogenic_cell_types.split(",") if c.strip()]
    out_prefix = out_prefix or disease.replace(" ", "_")
    tis = f" and tissue_general == '{tissue}'" if tissue else ""
    rng = np.random.default_rng(0)

    def fetch(vf, label, cap):
        try:
            a = cellxgene_census.get_anndata(
                census, organism="Homo sapiens", obs_value_filter=vf,
                obs_column_names=["donor_id", "cell_type", "disease", "tissue_general", "assay", "dataset_id"])
        except Exception as e:
            print(f"[skip {label}] {type(e).__name__}: {e}")
            return None
        if a.n_obs == 0:
            print(f"[empty {label}]")
            return None
        if a.n_obs > cap:
            a = a[np.sort(rng.choice(a.n_obs, cap, replace=False))].copy()
        a.obs["radar_pop"] = label
        return a

    with cellxgene_census.open_soma(census_version=CENSUS_VERSION) as census:
        obs = census["census_data"]["homo_sapiens"].obs
        avail = obs.read(value_filter=f"disease == '{disease}'{tis}",
                         column_names=["cell_type"]).concat().to_pandas()["cell_type"].astype(str)
        resolved = [c for c in sorted(avail.unique()) if c.lower() in pct or any(t in c.lower() for t in pct)]
        if not resolved:
            raise RuntimeError(f"No cell types matched {pct}; available: {sorted(avail.unique())[:25]}")
        lab_in = "[" + ", ".join(f"'{c}'" for c in resolved) + "]"
        print(f"[resolve] {disease}: pathogenic = {resolved}")
        P = fetch(f"disease == '{disease}' and cell_type in {lab_in}{tis}", "P", max_cells_per_pop)
        if P is None:
            raise RuntimeError("no pathogenic cells")
        H = fetch(f"disease == 'normal' and cell_type in {lab_in}{tis}", "H", ref_cap)
        B = fetch(f"disease == '{disease}'{tis}", "B", max_cells_per_pop)
        if B is not None:
            B = B[~B.obs["cell_type"].astype(str).isin(resolved)].copy()

    parts = [x for x in (P, H, B) if x is not None and x.n_obs > 0]
    adata = ad.concat(parts, join="inner", merge="same")
    adata.obs_names_make_unique()
    sc.pp.normalize_total(adata, target_sum=1e4)         # CP10k once; per-cell, reuse per cohort
    pop_all = adata.obs["radar_pop"].astype(str).to_numpy()
    dsid = adata.obs["dataset_id"].astype(str).to_numpy()
    donor = adata.obs["donor_id"].astype(str).to_numpy()
    genes_all = (adata.var["feature_name"] if "feature_name" in adata.var
                 else adata.var_names).to_numpy().astype(str)
    X = adata.X.tocsr() if hasattr(adata.X, "tocsr") else adata.X

    # candidate datasets: P datasets with enough cells & donors, largest first
    pmask = pop_all == "P"
    dfp = pd.DataFrame({"ds": dsid[pmask], "donor": donor[pmask]})
    stats = dfp.groupby("ds").agg(n_cells=("donor", "size"), n_donors=("donor", "nunique"))
    stats = stats[(stats.n_cells >= min_cells) & (stats.n_donors >= min_donors)].sort_values("n_cells", ascending=False)
    chosen = list(stats.index[:max_datasets])
    print(f"[datasets] {len(chosen)} qualifying P datasets of {dfp.ds.nunique()}: "
          f"{[(d[:8], int(stats.loc[d,'n_cells']), int(stats.loc[d,'n_donors'])) for d in chosen]}")

    cohorts, man_add = [], []
    for d in chosen:
        sel = ((pop_all == "P") & (dsid == d)) | (pop_all == "H") | ((pop_all == "B") & (dsid == d))
        if not (((pop_all == "P") & (dsid == d)).any() and ((pop_all == "H") | ((pop_all == "B") & (dsid == d))).any()):
            continue
        idx = np.where(sel)[0]
        Xd = X[idx]
        pop_d = pop_all[idx]
        don_d = donor[idx]
        det = np.asarray((Xd[pop_d == "P"] > 0).mean(axis=0)).ravel()
        keep = np.where(det >= min_detect_frac)[0]
        keep = keep[filter_technical(genes_all[keep])]
        if len(keep) < 50:
            print(f"[skip {d[:8]}] only {len(keep)} candidate genes")
            continue
        Xc = np.asarray(Xd[:, keep].todense()) if hasattr(Xd, "todense") else np.asarray(Xd[:, keep])
        df = score_matrix(Xc, genes_all[keep], don_d, pop_d, pos_label="P")
        ref = "H" if (pop_d == "H").any() else "B"
        out_name = f"{out_prefix}_{d[:8]}"
        df.to_parquet(f"{DATA}/{out_name}_racs.parquet")
        npd = int(len(set(don_d[pop_d == "P"])))
        meta = {"disease": disease, "source": f"CELLxGENE dataset {d}", "cohort": d[:8],
                "cell_counts": {p: int((pop_d == p).sum()) for p in set(pop_d)},
                "n_donors": {p: int(len(set(don_d[pop_d == p]))) for p in set(pop_d)},
                "n_candidate_genes": int(len(keep)), "reference_pop": ref, "census_version": CENSUS_VERSION,
                "top25": df.head(25).to_dict(orient="records")}
        json.dump(meta, open(f"{DATA}/{out_name}_meta.json", "w"), indent=2, default=float)
        man_add.append({"disease": disease, "out_name": out_name, "cell_type": pathogenic_cell_types,
                        "n_genes": int(len(keep)), "n_donors_P": npd, "reference_pop": ref, "has_umap": False})
        cohorts.append({"out_name": out_name, "dataset_id": d, "n_donors_P": npd,
                        "n_P_cells": int((pop_d == "P").sum()), "top5": df.head(5)["gene"].tolist()})
        print(f"[cohort {d[:8]}] P={int((pop_d=='P').sum())} cells / {npd} donors, {len(keep)} genes, ref={ref} "
              f"-> top: {df.head(5)['gene'].tolist()}")

    man_path = f"{DATA}/manifest.json"
    try:
        manifest = json.load(open(man_path))
    except Exception:
        manifest = {"diseases": []}
    add_names = {m["out_name"] for m in man_add}
    manifest["diseases"] = [d for d in manifest["diseases"] if d.get("out_name") not in add_names] + man_add
    json.dump(manifest, open(man_path, "w"), indent=2)
    vol.commit()
    summary = {"disease": disease, "n_cohorts": len(cohorts), "cohorts": cohorts}
    print(json.dumps(summary, indent=2, default=float))
    return summary


@app.function(image=image, volumes={DATA: vol}, timeout=5400, memory=49152, cpu=8.0)
def ingest_and_score_geo(gse: str = "GSE163973", disease_label: str = "keloid",
                         out_name: str = "keloid_geo", min_detect_frac: float = 0.03,
                         disease_tokens: str = "KL,KELOID", control_tokens: str = "",
                         disease_name: str = "",
                         fibroblast_markers: str = "COL1A1,COL1A2,LUM,DCN,PDGFRA,COL3A1") -> dict:
    """Ingest an INDEPENDENT GEO scRNA cohort (10x RAW.tar), gate fibroblasts by
    markers, and run RACS. This is the second keloid cohort (disease vs normal-scar)
    for cross-cohort validation. GSE163973 = Deng 2021 (3 keloid + 3 normal scar).
    """
    import gzip
    import os
    import re
    import shutil
    import tarfile
    import urllib.request

    import anndata as ad
    import numpy as np
    import scanpy as sc
    from scipy.io import mmread

    from radar_scout.scoring import score_matrix
    from radar_scout.genesets import filter_technical

    wd = "/tmp/geo"
    os.makedirs(wd, exist_ok=True)
    stub = gse[:-3] + "nnn"
    url = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{stub}/{gse}/suppl/{gse}_RAW.tar"
    tarp = f"{wd}/{gse}_RAW.tar"
    if not os.path.exists(tarp):
        print(f"downloading {url}")
        urllib.request.urlretrieve(url, tarp)
    with tarfile.open(tarp) as t:
        t.extractall(wd)

    # discover all files recursively, group by GSM id
    allfiles = []
    for root, _, fs in os.walk(wd):
        for f in fs:
            if f.startswith("GSM"):
                allfiles.append(os.path.join(root, f))
    groups: dict = {}
    for f in allfiles:
        m = re.match(r"(GSM\d+)", os.path.basename(f))
        if m:
            groups.setdefault(m.group(1), []).append(f)

    def _read_mtx(path):
        if path.endswith(".gz"):
            tmp = path[:-3]
            with gzip.open(path) as fin, open(tmp, "wb") as fout:
                shutil.copyfileobj(fin, fout)
            path = tmp
        return mmread(path).tocsr()

    def _lines(path):
        op = gzip.open(path, "rt") if path.endswith(".gz") else open(path)
        return [ln.rstrip("\n") for ln in op]

    adatas = []
    for gsm, fs in sorted(groups.items()):
        search = list(fs)
        # some series nest each sample as GSM..._matrix.tar.gz (a 10x bundle inside the tar)
        nested = next((f for f in fs if f.endswith(".tar.gz") and ".mtx" not in f.lower()), None)
        if nested and not any(".mtx" in f.lower() for f in fs):
            gdir = os.path.join(wd, gsm + "_x")
            os.makedirs(gdir, exist_ok=True)
            with tarfile.open(nested) as t:
                t.extractall(gdir)
            search = [os.path.join(r, f) for r, _, ffs in os.walk(gdir) for f in ffs]
        # many series ship one 10x .h5 per sample instead of an MTX triplet
        h5f = next((f for f in search if f.lower().endswith(".h5")), None)
        if h5f:
            try:
                a = sc.read_10x_h5(h5f)
                a.var_names_make_unique()
                a.obs_names = [f"{gsm}_{b}" for b in a.obs_names]
            except Exception as e:
                print(f"[skip {gsm}] h5 read failed: {type(e).__name__}: {e}")
                continue
        else:
            mtxf = next((f for f in search if "matrix" in os.path.basename(f).lower() and ".mtx" in f.lower()), None)
            bcf = next((f for f in search if "barcode" in os.path.basename(f).lower()), None)
            ftf = next((f for f in search if "feature" in os.path.basename(f).lower() or "genes" in os.path.basename(f).lower()), None)
            if not (mtxf and bcf and ftf):
                print(f"[skip {gsm}] missing 10x files among: {[os.path.basename(x) for x in search][:6]}")
                continue
            X = _read_mtx(mtxf)  # genes x cells (usually)
            barcodes = [ln.split("\t")[0] for ln in _lines(bcf)]
            symbols = [(ln.split("\t")[1] if "\t" in ln else ln).strip().strip('"').strip("'")
                       for ln in _lines(ftf)]
            dims = set(X.shape)
            if len(symbols) - 1 in dims and len(symbols) not in dims:   # header row
                symbols = symbols[1:]
            if len(barcodes) - 1 in dims and len(barcodes) not in dims:
                barcodes = barcodes[1:]
            if X.shape[0] == len(symbols) and X.shape[1] == len(barcodes):
                X = X.T.tocsr()                      # genes x cells -> cells x genes
            elif not (X.shape[1] == len(symbols) and X.shape[0] == len(barcodes)):
                # neither orientation matches: mislabelling would poison the inner-join
                print(f"[skip {gsm}] shape {X.shape} != genes={len(symbols)} / cells={len(barcodes)}")
                continue
            a = ad.AnnData(X)
            a.var_names = symbols[: a.n_vars]
            a.var_names_make_unique()
            a.obs_names = [f"{gsm}_{b}" for b in barcodes[: a.n_obs]]
        a.obs["donor"] = gsm
        blob = " ".join(os.path.basename(x) for x in fs).upper()
        dtok = [t.strip().upper() for t in disease_tokens.split(",") if t.strip()]
        ctok = [t.strip().upper() for t in control_tokens.split(",") if t.strip()]
        if any(t in blob for t in dtok):
            cond = "P"
        elif not ctok or any(t in blob for t in ctok):
            cond = "H"
        else:
            print(f"[skip {gsm}] no disease/control token matched: {blob[:70]}")
            continue
        a.obs["condition"] = cond
        print(f"[{gsm}] {a.n_obs} cells x {a.n_vars} genes -> {cond}")
        adatas.append(a)
    if not adatas:
        raise RuntimeError("no 10x samples parsed from RAW.tar")

    # A series can ship several 10x references (gene symbols vs Ensembl IDs, different
    # builds). Mixing them collapses the inner-join to a handful of genes, so keep only
    # the largest self-consistent gene space.
    from collections import Counter
    sigs = [(a.n_vars, a.var_names[0], a.var_names[-1]) for a in adatas]
    modal_sig = Counter(sigs).most_common(1)[0][0]
    if any(s != modal_sig for s in sigs):
        keep_a = [a for a, s in zip(adatas, sigs) if s == modal_sig]
        print(f"[gene-space] keeping {len(keep_a)}/{len(adatas)} samples on the majority "
              f"reference ({modal_sig[0]} genes); dropping the rest")
        adatas = keep_a

    adata = ad.concat(adatas, join="inner")
    if adata.n_vars < 1000:
        raise RuntimeError(f"only {adata.n_vars} genes after inner-join across {len(adatas)} "
                           f"samples — gene-ID mismatch")
    conds = set(adata.obs["condition"].astype(str))
    if not {"P", "H"} <= conds:
        raise RuntimeError(f"need both disease and control samples on one reference; got {conds}")
    adata.obs_names_make_unique()

    # QC
    sc.pp.filter_cells(adata, min_genes=200)
    adata.var["mt"] = adata.var_names.str.upper().str.startswith("MT-")
    sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], inplace=True, percent_top=None)
    adata = adata[adata.obs["pct_counts_mt"] < 20].copy()

    sc.pp.normalize_total(adata, target_sum=1e4)  # CP10k
    lg = adata.copy()
    sc.pp.log1p(lg)

    def mscore(genes):
        gg = [g for g in genes if g in lg.var_names]
        return np.asarray(lg[:, gg].X.mean(axis=1)).ravel() if gg else np.zeros(lg.n_obs)

    fib = mscore([m.strip().upper() for m in fibroblast_markers.split(",") if m.strip()])
    imm = mscore(["PTPRC", "CD3D", "CD68", "LYZ"])
    endo = mscore(["PECAM1", "VWF", "CLDN5"])
    kera = mscore(["KRT14", "KRT5", "KRT1"])
    is_fib = (fib > 0.5) & (fib > imm) & (fib > endo) & (fib > kera)
    print(f"fibroblasts gated: {int(is_fib.sum())}/{adata.n_obs}")
    adata = adata[is_fib].copy()

    pop = adata.obs["condition"].astype(str).to_numpy()   # already "P"/"H" from token match
    donor = adata.obs["donor"].astype(str).to_numpy()
    genes_all = adata.var_names.to_numpy().astype(str)
    Xp = adata[pop == "P"].X
    detect = np.asarray((Xp > 0).mean(axis=0)).ravel()
    keep = np.where(detect >= min_detect_frac)[0]
    genes = genes_all[keep]
    m = filter_technical(genes)
    keep, genes = keep[m], genes[m]
    Xc = adata[:, keep].X
    Xc = np.asarray(Xc.todense()) if hasattr(Xc, "todense") else np.asarray(Xc)

    df = score_matrix(Xc, genes, donor, pop, pos_label="P")
    df.to_parquet(f"{DATA}/{out_name}_racs.parquet")
    counts = {p: int((pop == p).sum()) for p in ["P", "H"]}
    ndon = {p: int(len(set(donor[pop == p]))) for p in ["P", "H"]}
    meta = {"disease": disease_name or disease_label, "source": gse, "cohort": "GEO",
            "cell_counts": counts, "n_donors": ndon, "n_candidate_genes": int(len(genes)),
            "reference_pop": "H (normal scar)", "top25": df.head(25).to_dict(orient="records")}
    with open(f"{DATA}/{out_name}_meta.json", "w") as fh:
        json.dump(meta, fh, indent=2, default=float)
    vol.commit()

    print(json.dumps({"gse": gse, "cell_counts": counts, "n_donors": ndon,
                      "n_candidate_genes": int(len(genes))}, indent=2))
    print("TOP 20 (GEO cohort):")
    for r in df.head(20).to_dict("records"):
        print(f"  {str(r['gene'])[:16]:16s} RACS={r['RACS']:.3f}  Sep={r['Sep']:.3f}  "
              f"log2FC={r.get('log2FC', float('nan')):.2f}  detect_P={r.get('detect_P', float('nan')):.0f}%")
    return meta


@app.function(image=image, volumes={DATA: vol}, timeout=9000, memory=131072, cpu=8.0)
def ingest_h5ad(
    url: str = "",
    out_name: str = "ipf_adams",
    disease_name: str = "pulmonary fibrosis",
    disease_label: str = "idiopathic pulmonary fibrosis",
    control_label: str = "normal",
    disease_col: str = "disease",
    celltype_col: str = "cell_type",
    donor_col: str = "donor_id",
    fibroblast_labels: str = "fibroblast,myofibroblast",
    min_detect_frac: float = 0.05,
    max_cells_per_pop: int = 60000,
) -> dict:
    """Ingest a curated h5ad (e.g. CZ CELLxGENE Discover) as one fibrosis cohort.

    Uses the file's OWN obs annotations (disease / cell_type / donor) to define
    P (diseased fibroblasts), H (control fibroblasts), and B (diseased non-fibroblast
    bystanders) — far more robust than parsing GEO filenames. Scores with RACS and
    appends the cohort to the dashboard manifest under ``disease_name`` so multiple
    cohorts of the same organ pool automatically.
    """
    import os
    import urllib.request

    import numpy as np
    import scanpy as sc

    from radar_scout.scoring import score_matrix
    from radar_scout.genesets import filter_technical

    fib = [s.strip().lower() for s in fibroblast_labels.split(",") if s.strip()]
    os.makedirs("/tmp/h5", exist_ok=True)
    path = f"/tmp/h5/{out_name}.h5ad"
    if not os.path.exists(path):
        print(f"downloading {url}")
        urllib.request.urlretrieve(url, path)
    print(f"[read] {path} ({os.path.getsize(path)/1e9:.2f} GB)")
    adata = sc.read_h5ad(path)
    print(f"[loaded] {adata.n_obs} cells x {adata.n_vars} genes; obs: {list(adata.obs.columns)[:20]}")

    def pick(col, *alts):
        for c in (col, *alts):
            if c in adata.obs.columns:
                return c
        raise RuntimeError(f"none of {(col,)+alts} in obs: {list(adata.obs.columns)}")

    dcol = pick(disease_col, "disease", "condition", "Diagnosis", "diagnosis", "status")
    ccol = pick(celltype_col, "cell_type", "celltype", "cell_type_annotation", "CellType", "author_cell_type")
    ncol = pick(donor_col, "donor_id", "donor", "individual", "patient", "subject", "sampleID", "orig.ident")
    dz = adata.obs[dcol].astype(str).str.lower()
    ct = adata.obs[ccol].astype(str).str.lower()
    is_fib = ct.apply(lambda s: any(f in s for f in fib)).to_numpy()
    is_dz = dz.str.contains(disease_label.lower(), na=False).to_numpy()
    is_ctrl = dz.str.contains(control_label.lower(), na=False).to_numpy()
    print(f"[labels] disease vals: {sorted(dz.unique())[:8]} | fib cells={int(is_fib.sum())} "
          f"dz={int(is_dz.sum())} ctrl={int(is_ctrl.sum())}")

    pop = np.full(adata.n_obs, "", dtype=object)
    pop[is_fib & is_dz] = "P"
    pop[is_fib & is_ctrl] = "H"
    pop[~is_fib & is_dz] = "B"          # diseased non-fibroblast bystanders (cell-type specificity)
    rng = np.random.default_rng(0)
    keep_idx = []
    for lab in ("P", "H", "B"):
        idx = np.where(pop == lab)[0]
        if len(idx) > max_cells_per_pop:
            idx = np.sort(rng.choice(idx, max_cells_per_pop, replace=False))
        keep_idx.append(idx)
    keep_idx = np.concatenate(keep_idx) if keep_idx else np.array([], int)
    adata = adata[keep_idx].copy()
    pop = pop[keep_idx]
    if (pop == "P").sum() < 50 or ((pop == "H").sum() < 50 and (pop == "B").sum() < 50):
        raise RuntimeError(f"insufficient cells: P={int((pop=='P').sum())} H={int((pop=='H').sum())} "
                           f"B={int((pop=='B').sum())}")

    # raw counts for CP10k: prefer layers['counts'] / raw, else assume .X is counts
    if "counts" in adata.layers:
        adata.X = adata.layers["counts"].copy()
    elif adata.raw is not None and adata.raw.n_vars == adata.n_vars:
        adata.X = adata.raw.X.copy()
    sc.pp.normalize_total(adata, target_sum=1e4)

    genes = (adata.var["feature_name"] if "feature_name" in adata.var else adata.var_names).to_numpy().astype(str)
    donor = adata.obs[ncol].astype(str).to_numpy()
    X = adata.X.tocsr() if hasattr(adata.X, "tocsr") else adata.X
    det = np.asarray((X[pop == "P"] > 0).mean(axis=0)).ravel()
    kp = np.where(det >= min_detect_frac)[0]
    kp = kp[filter_technical(genes[kp])]
    Xc = np.asarray(X[:, kp].todense()) if hasattr(X, "todense") else np.asarray(X[:, kp])
    df = score_matrix(Xc, genes[kp], donor, pop.astype(str), pos_label="P")

    ref = "H" if (pop == "H").any() else "B"
    df.to_parquet(f"{DATA}/{out_name}_racs.parquet")
    counts = {p: int((pop == p).sum()) for p in ("P", "H", "B") if (pop == p).any()}
    ndon = {p: int(len(set(donor[pop == p]))) for p in counts}
    meta = {"disease": disease_name, "source": url, "cohort": out_name,
            "cell_counts": counts, "n_donors": ndon, "n_candidate_genes": int(len(kp)),
            "reference_pop": ref, "top25": df.head(25).to_dict(orient="records")}
    json.dump(meta, open(f"{DATA}/{out_name}_meta.json", "w"), indent=2, default=float)
    man_path = f"{DATA}/manifest.json"
    try:
        manifest = json.load(open(man_path))
    except Exception:
        manifest = {"diseases": []}
    manifest["diseases"] = [d for d in manifest["diseases"] if d.get("out_name") != out_name]
    manifest["diseases"].append({"disease": disease_name, "out_name": out_name,
                                 "cell_type": fibroblast_labels, "n_genes": int(len(kp)),
                                 "n_donors_P": ndon.get("P", 0), "reference_pop": ref, "has_umap": False})
    json.dump(manifest, open(man_path, "w"), indent=2)
    vol.commit()
    print(json.dumps({"out_name": out_name, "counts": counts, "n_donors": ndon,
                      "n_genes": int(len(kp)), "top10": df.head(10)["gene"].tolist()}, indent=2))
    return meta


@app.function(image=image, volumes={DATA: vol}, timeout=10800, memory=131072, cpu=8.0)
def ingest_geo_matrix(
    gse: str = "GSE135893",
    out_name: str = "lung_habermann",
    disease_name: str = "pulmonary fibrosis",
    matrix_file: str = "",
    features_file: str = "",
    barcodes_file: str = "",
    meta_file: str = "",
    disease_col: str = "Diagnosis",
    disease_value: str = "IPF",
    control_value: str = "Control",
    celltype_col: str = "celltype",
    fibroblast_labels: str = "fibroblast,myofibroblast",
    donor_col: str = "Sample_Name",
    meta_sep: str = ",",
    min_detect_frac: float = 0.05,
    max_cells_per_pop: int = 60000,
) -> dict:
    """Ingest a GEO cohort deposited as ONE combined sparse matrix + a per-cell
    metadata table (Adams GSE136831, Habermann GSE135893, ...). Uses the deposited
    per-cell annotations (disease / cell_type / donor) to define P/H/B — no marker
    gating. Appends the cohort to the dashboard manifest under ``disease_name``.
    """
    import gzip
    import os
    import urllib.request

    import anndata as ad
    import numpy as np
    import pandas as pd
    import scanpy as sc
    from scipy.io import mmread

    from radar_scout.scoring import score_matrix
    from radar_scout.genesets import filter_technical

    fib = [s.strip().lower() for s in fibroblast_labels.split(",") if s.strip()]
    stub = gse[:-3] + "nnn"
    base = f"https://ftp.ncbi.nlm.nih.gov/geo/series/{stub}/{gse}/suppl/"
    wd = f"/tmp/{gse}"
    os.makedirs(wd, exist_ok=True)

    def dl(fn):
        p = f"{wd}/{fn}"
        if not os.path.exists(p):
            print(f"downloading {fn}")
            urllib.request.urlretrieve(base + fn, p)
        return p

    def opent(p):
        return gzip.open(p, "rt") if p.endswith(".gz") else open(p)

    X = mmread(gzip.open(dl(matrix_file)) if matrix_file.endswith(".gz") else dl(matrix_file)).tocsr()
    feats = [ln.rstrip("\n").split("\t") for ln in opent(dl(features_file))]
    # symbol = last column; some series quote their fields ("COL5A2") -> strip, else no gene joins
    genes = np.array([f[-1].strip().strip('"').strip("'") for f in feats])
    barc = [ln.rstrip("\n").split("\t")[0] for ln in opent(dl(barcodes_file))]
    dims = set(X.shape)
    if len(genes) - 1 in dims and len(genes) not in dims:   # features file has a header row
        genes = genes[1:]
    if len(barc) - 1 in dims and len(barc) not in dims:      # barcodes file has a header row
        barc = barc[1:]
    if X.shape[0] == len(genes) and X.shape[1] == len(barc):
        X = X.T.tocsr()                                # -> cells x genes
    adata = ad.AnnData(X)
    adata.var_names = genes[: adata.n_vars]
    adata.var_names_make_unique()
    adata.obs_names = [str(b) for b in barc[: adata.n_obs]]

    sep = "," if meta_file.lower().replace(".gz", "").endswith(".csv") else "\t"  # auto: csv vs tsv/txt
    meta = pd.read_csv(dl(meta_file), sep=sep, compression="gzip", low_memory=False)
    meta.columns = [str(c) for c in meta.columns]
    # align metadata to matrix barcodes: pick the metadata column that best matches barcodes
    bset = set(adata.obs_names)
    cand = [(sum(str(v) in bset for v in meta[c].astype(str).head(2000)), c) for c in meta.columns]
    ov, bc_col = max(cand)
    if ov > 100:
        meta = meta.drop_duplicates(bc_col).set_index(meta[bc_col].astype(str))
        meta = meta.reindex(adata.obs_names)
    else:
        meta.index = adata.obs_names[: len(meta)]      # assume row-order alignment
        meta = meta.reindex(adata.obs_names)
    print(f"[meta] matched barcode col='{bc_col}' overlap={ov}; cols={list(meta.columns)[:15]}")

    dz = meta[disease_col].astype(str).str.lower()
    ct = meta[celltype_col].astype(str).str.lower()
    donor = meta[donor_col].astype(str).to_numpy()
    is_fib = ct.apply(lambda s: any(f in s for f in fib)).to_numpy()
    is_dz = dz.str.contains(disease_value.lower(), na=False).to_numpy()
    is_ctrl = dz.str.contains(control_value.lower(), na=False).to_numpy()
    print(f"[labels] disease={sorted(dz.dropna().unique())[:8]} | fib={int(is_fib.sum())} "
          f"P={int((is_fib&is_dz).sum())} H={int((is_fib&is_ctrl).sum())}")

    pop = np.full(adata.n_obs, "", dtype=object)
    pop[is_fib & is_dz] = "P"
    pop[is_fib & is_ctrl] = "H"
    pop[(~is_fib) & is_dz] = "B"
    rng = np.random.default_rng(0)
    keep = []
    for lab in ("P", "H", "B"):
        idx = np.where(pop == lab)[0]
        if len(idx) > max_cells_per_pop:
            idx = np.sort(rng.choice(idx, max_cells_per_pop, replace=False))
        keep.append(idx)
    keep = np.concatenate(keep)
    adata, pop, donor = adata[keep].copy(), pop[keep], donor[keep]
    if (pop == "P").sum() < 50:
        raise RuntimeError(f"too few P cells ({int((pop=='P').sum())})")

    sc.pp.normalize_total(adata, target_sum=1e4)
    genes = adata.var_names.to_numpy().astype(str)
    Xn = adata.X.tocsr()
    det = np.asarray((Xn[pop == "P"] > 0).mean(axis=0)).ravel()
    kp = np.where(det >= min_detect_frac)[0]
    kp = kp[filter_technical(genes[kp])]
    Xc = np.asarray(Xn[:, kp].todense())
    df = score_matrix(Xc, genes[kp], donor, pop.astype(str), pos_label="P")

    ref = "H" if (pop == "H").any() else "B"
    df.to_parquet(f"{DATA}/{out_name}_racs.parquet")
    counts = {p: int((pop == p).sum()) for p in ("P", "H", "B") if (pop == p).any()}
    ndon = {p: int(len(set(donor[pop == p]))) for p in counts}
    meta_out = {"disease": disease_name, "source": gse, "cohort": out_name,
                "cell_counts": counts, "n_donors": ndon, "n_candidate_genes": int(len(kp)),
                "reference_pop": ref, "top25": df.head(25).to_dict(orient="records")}
    json.dump(meta_out, open(f"{DATA}/{out_name}_meta.json", "w"), indent=2, default=float)
    vol.commit()
    print(json.dumps({"out_name": out_name, "counts": counts, "n_donors": ndon,
                      "top10": df.head(10)["gene"].tolist()}, indent=2))
    return meta_out


def _profile_table(X, genes, gene_names, cell_type, donor, state, min_cells=10,
                   lib_size=None, thresholds=None, raw=None, raw_pos=None):
    """Per (gene x cell_type x disease-state) absolute abundance table.

    Reports DONOR-AWARE means (mean of per-donor means) so one deeply-sequenced
    patient cannot dominate, in the same CP10k units the scorer uses. CPM is the
    same quantity x100 and is reported alongside because sensor designers think in
    counts per million.
    """
    import numpy as np
    import pandas as pd

    pos = {g: i for i, g in enumerate(gene_names)}
    rows = []
    keys = pd.DataFrame({"ct": cell_type, "st": state}).groupby(["ct", "st"], sort=False).indices
    for (ct, st), idx in keys.items():
        if len(idx) < min_cells:
            continue
        dsub = donor[idx]
        for g in genes:
            j = pos.get(g)
            if j is None:
                continue
            x = np.asarray(X[idx, j].todense()).ravel() if hasattr(X, "todense") else np.asarray(X[idx, j]).ravel()
            per_donor_mean, per_donor_det = [], []
            for d in np.unique(dsub):
                m = dsub == d
                if m.sum() >= 3:
                    per_donor_mean.append(float(x[m].mean()))
                    per_donor_det.append(float((x[m] > 0).mean()))
            if not per_donor_mean:
                per_donor_mean, per_donor_det = [float(x.mean())], [float((x > 0).mean())]
            mean_cp10k = float(np.mean(per_donor_mean))
            # CP10k is a FRACTION of each cell's transcriptome, not a molecule count.
            # A lymphocyte carries far less total mRNA than a fibroblast, so equal CP10k
            # means very different absolute transcript numbers — and a threshold sensor
            # responds to molecules. Convert using the cell type's own library size.
            med_lib = float(np.median(lib_size[idx])) if lib_size is not None else float("nan")
            est_mol = mean_cp10k * med_lib / 1e4 if lib_size is not None else float("nan")
            # Fraction of cells that would actually cross the sensor's operating point.
            thr = (thresholds or {}).get(g)
            pct_over = float(100 * (x >= thr).mean()) if thr is not None else float("nan")
            # RAW UMI counts — no normalisation at all. Within one dataset this is the
            # most direct statement of "how many mRNA molecules of this gene did we
            # actually detect per cell", which is what a threshold sensor responds to.
            rc = {}
            if raw is not None and g in (raw_pos or {}):
                rv = raw[idx, raw_pos[g]]
                rv = np.asarray(rv.todense()).ravel() if hasattr(rv, "todense") else np.asarray(rv).ravel()
                rc = {"mean_counts": float(rv.mean()), "median_counts": float(np.median(rv)),
                      "max_counts": float(rv.max()),
                      "pct_ge1": float(100 * (rv >= 1).mean()),
                      "pct_ge3": float(100 * (rv >= 3).mean()),
                      "pct_ge10": float(100 * (rv >= 10).mean()),
                      "mean_counts_in_expressing": float(rv[rv > 0].mean()) if (rv > 0).any() else 0.0}
            rows.append({
                "gene": g, "cell_type": str(ct), "state": str(st),
                "n_cells": int(len(idx)), "n_donors": int(len(set(dsub))), **rc,
                "mean_cp10k": mean_cp10k, "mean_cpm": mean_cp10k * 100.0,
                "median_cp10k": float(np.median(per_donor_mean)),
                "detect_pct": float(100 * np.mean(per_donor_det)),
                "mean_in_expressing_cp10k": float(x[x > 0].mean()) if (x > 0).any() else 0.0,
                "median_lib_size": med_lib,
                "est_molecules_per_cell": est_mol,
                "pct_over_threshold": pct_over,
                "threshold_cp10k": float(thr) if thr is not None else float("nan"),
            })
    return pd.DataFrame(rows)


@app.function(image=image, volumes={DATA: vol}, timeout=9000, memory=131072, cpu=8.0)
def celltype_expression_profile(
    genes: str = "POSTN,ADAM12,COL1A1",
    out_name: str = "keloid_profile",
    url: str = "",
    disease: str = "",
    tissue: str = "",
    disease_col: str = "disease",
    celltype_col: str = "cell_type",
    donor_col: str = "donor_id",
    control_label: str = "normal",
    max_cells: int = 250000,
    thresholds: str = "",
) -> dict:
    """Absolute expression of candidate triggers in EVERY cell type of a tissue.

    The scorer collapses all non-target cell types into a single bystander mean,
    which hides which specific cell type a sensor would misfire in. This resolves
    that: for each gene it reports mean CP10k / CPM, detection %, and cell/donor
    counts per cell type, separately for diseased and control tissue.

    Two sources: a curated h5ad (``url``) or the CELLxGENE Census (``disease`` +
    optional ``tissue``), whichever is given.
    """
    import os
    import urllib.request

    import numpy as np
    import scanpy as sc

    gl = [g.strip() for g in genes.split(",") if g.strip()]

    if url:
        os.makedirs("/tmp/prof", exist_ok=True)
        path = f"/tmp/prof/{out_name}.h5ad"
        if not os.path.exists(path):
            print(f"downloading {url}")
            urllib.request.urlretrieve(url, path)
        adata = sc.read_h5ad(path)
        src = url
    else:
        import cellxgene_census
        tis = f" and tissue_general == '{tissue}'" if tissue else ""
        with cellxgene_census.open_soma(census_version=CENSUS_VERSION) as census:
            parts = []
            for dz in (disease, control_label):
                a = cellxgene_census.get_anndata(
                    census, organism="Homo sapiens",
                    obs_value_filter=f"disease == '{dz}'{tis}",
                    obs_column_names=["donor_id", "cell_type", "disease", "tissue_general"])
                print(f"[{dz}] {a.n_obs} cells, {a.obs['cell_type'].nunique()} cell types")
                parts.append(a)
        import anndata as ad
        adata = ad.concat(parts, join="inner", merge="same")
        src = f"CELLxGENE Census {CENSUS_VERSION} · {disease} / {control_label}"

    if adata.n_obs > max_cells:
        rng = np.random.default_rng(0)
        adata = adata[np.sort(rng.choice(adata.n_obs, max_cells, replace=False))].copy()
    print(f"[profile] {adata.n_obs} cells x {adata.n_vars} genes")

    # Resolve genuine raw counts. Many curated h5ads keep normalised (or worse,
    # scaled/centred) values in .X and the counts in .layers['counts'] or .raw.
    if "counts" in adata.layers:
        adata.X = adata.layers["counts"].copy()
        print("[counts] using layers['counts']")
    elif adata.raw is not None and adata.raw.shape[0] == adata.n_obs:
        rw = adata.raw.to_adata()
        rw.obs = adata.obs.copy()
        adata = rw
        print("[counts] using .raw")
    else:
        print("[counts] using .X as-is")
    # Fail loudly rather than emit impossible numbers: scaled/centred matrices give
    # negative "counts" and negative library sizes.
    _mn = float(adata.X.min())
    if _mn < 0:
        raise RuntimeError(
            f"matrix has negative values (min={_mn:.3f}) — it is scaled/centred, not counts. "
            "Molecules per cell cannot be computed from it. Point --url at a dataset whose "
            "raw counts are in .X, .raw or layers['counts'].")
    # Decisive test: raw UMI counts are INTEGERS. Log- or CP10k-normalised matrices are
    # non-negative too, so the sign check above misses them — and normalising an already
    # log-transformed matrix yields plausible-looking but meaningless numbers.
    _s = adata.X[: min(2000, adata.n_obs)]
    _v = _s.data if hasattr(_s, "data") else np.asarray(_s).ravel()
    _v = _v[_v != 0][:20000]
    if _v.size and not np.allclose(_v, np.round(_v), atol=1e-6):
        raise RuntimeError(
            f"matrix is not integer counts (e.g. {_v[:4]}) — it is already normalised "
            "(log1p or CP10k). Molecule counts cannot be recovered from it.")
    # Capture library size AND the raw per-gene counts BEFORE normalising. The raw
    # counts are the "how many molecules in this cell" answer; CP10k is derived.
    lib = np.asarray(adata.X.sum(axis=1)).ravel()
    if float(np.median(lib)) < 100:
        print(f"[warn] median library size is only {np.median(lib):.1f} — .X may already be normalised; "
              "molecule counts will not be meaningful.")
    _gn = (adata.var["feature_name"] if "feature_name" in adata.var else adata.var_names).to_numpy().astype(str)
    _pos = {g: i for i, g in enumerate(_gn)}
    keep_idx = [_pos[g] for g in gl if g in _pos]
    raw_pos = {g: k for k, g in enumerate([g for g in gl if g in _pos])}
    raw_mat = adata.X[:, keep_idx].copy() if keep_idx else None
    if raw_mat is not None and hasattr(raw_mat, "tocsr"):
        raw_mat = raw_mat.tocsr()
    print(f"[raw] captured counts for {len(keep_idx)}/{len(gl)} genes; "
          f"median library size {np.median(lib):.0f} UMIs/cell")
    sc.pp.normalize_total(adata, target_sum=1e4)   # CP10k, same basis as the scorer
    thr_map = {}
    for part in thresholds.split(","):
        if ":" in part:
            k, v = part.split(":", 1)
            try:
                thr_map[k.strip()] = float(v)
            except ValueError:
                pass

    def pick(c, *alts):
        for k in (c, *alts):
            if k in adata.obs.columns:
                return k
        raise RuntimeError(f"missing {c}; obs has {list(adata.obs.columns)[:20]}")

    dcol, ccol, ncol = pick(disease_col, "disease"), pick(celltype_col, "cell_type"), pick(donor_col, "donor_id", "donor")
    gene_names = (adata.var["feature_name"] if "feature_name" in adata.var else adata.var_names).to_numpy().astype(str)
    dz_vals = adata.obs[dcol].astype(str).str.lower()
    # An atlas can hold several diseases (this one carries keloid, localized scleroderma
    # and injury). Without this filter they would all be pooled as "diseased".
    if disease:
        keep = dz_vals.str.contains(disease.lower(), na=False) | dz_vals.str.contains(control_label.lower(), na=False)
        print(f"[filter] disease='{disease}' vs control='{control_label}': keeping {int(keep.sum())}/{len(keep)} cells "
              f"(dropped: {sorted(set(adata.obs[dcol].astype(str)[~keep.to_numpy()]))[:6]})")
        adata = adata[keep.to_numpy()].copy()
        lib = lib[keep.to_numpy()]
        if raw_mat is not None:
            raw_mat = raw_mat[keep.to_numpy()]
        dz_vals = adata.obs[dcol].astype(str).str.lower()
    state = np.where(dz_vals.str.contains(control_label.lower(), na=False), "control", "diseased")

    df = _profile_table(adata.X.tocsr() if hasattr(adata.X, "tocsr") else adata.X,
                        gl, gene_names, adata.obs[ccol].astype(str).to_numpy(),
                        adata.obs[ncol].astype(str).to_numpy(), state,
                        lib_size=lib, thresholds=thr_map, raw=raw_mat, raw_pos=raw_pos)
    if df.empty:
        raise RuntimeError("no rows produced — check gene names and cell-type column")

    df = df.sort_values(["gene", "state", "mean_cp10k"], ascending=[True, True, False])
    df.to_parquet(f"{DATA}/{out_name}_celltype_expr.parquet")
    # Absolute CP10k is only comparable BETWEEN cell types when they were sequenced in
    # the same experiment. A Census query pools many studies, so the diseased and
    # control arms can come from different labs/chemistries — record that so the
    # dashboard can warn instead of inviting a false comparison.
    same_dataset = bool(url)
    json.dump({"out_name": out_name, "source": src, "genes": gl,
               "n_cell_types": int(df["cell_type"].nunique()), "n_rows": int(len(df)),
               "same_dataset": same_dataset,
               "comparability": ("Diseased and control cells come from one dataset — absolute "
                                 "values are directly comparable across cell types."
                                 if same_dataset else
                                 "Cells are pooled across many independent studies. Absolute values "
                                 "are comparable WITHIN a cell type, but between-cell-type and "
                                 "diseased-vs-control differences are confounded by study, "
                                 "chemistry and sequencing depth.")},
              open(f"{DATA}/{out_name}_celltype_expr_meta.json", "w"), indent=2)
    vol.commit()

    for g in gl:
        sub = df[(df.gene == g) & (df.state == "diseased")].head(8)
        if sub.empty:
            continue
        print(f"\n=== {g} — diseased tissue, top cell types by abundance ===")
        for _, r in sub.iterrows():
            print(f"  {r.cell_type[:38]:40s} {r.mean_cp10k:9.2f} CP10k  ({r.mean_cpm:9.1f} CPM)  "
                  f"{r.detect_pct:5.1f}% of cells   n={int(r.n_cells)}")
    return {"out_name": out_name, "n_rows": int(len(df)), "cell_types": int(df["cell_type"].nunique())}


@app.local_entrypoint()
def main():
    """Default: run the cheap disease scan and print what's available."""
    res = census_disease_scan.remote()
    print("\n=== RADAR-Scout Census scan ===")
    print("summary_cell_counts columns:", res.get("columns"))
    for d in res["matched_diseases"]:
        cells = d.get("cells")
        print(f"  {d['disease']:45s} {cells:>12,} cells" if cells is not None else f"  {d['disease']}")
    if not res["matched_diseases"]:
        print("  (no matching diseases in Census — fall back to a GEO loader)")
