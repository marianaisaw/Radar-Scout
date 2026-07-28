"""RADAR Consensus Score (RCS): a stable, calibration-independent, uncertainty-aware
target ranking that aggregates evidence across cohorts and across metrics.

Why this exists
---------------
The per-cohort RACS uses Hill activation *magnitudes* that are still provisional
(the RADAR dose-response is not yet calibrated — see ROADMAP). Ranking a target on
any single activation-dependent number is therefore fragile. RCS deliberately ranks
on the **calibration-independent, sensor-relevant** signals only, and combines them
as an ensemble of *percentile ranks* so no single (possibly mis-scaled) metric drives
the order. It then reports how much the ranking would move if we dropped a cohort,
swapped the metric, or resampled the evidence — i.e. it quantifies its own confidence
instead of asserting a point estimate.

Design principles
-----------------
1. **Rank, don't trust magnitudes.** Every signal is converted to a within-cohort
   percentile (0-100, 100 = best) before combination. Immune to scale/calibration.
2. **Ensemble over metrics.** A real target should be good across *several* independent
   axes (near-binary detection, abundance x fold-change, donor-level AUC). Averaging
   percentiles is a Borda consensus — robust and hard to game.
3. **Donor-weighted cohort consensus.** Cohorts contribute in proportion to sqrt(n
   pathogenic donors): a 61-donor melanoma cohort should outweigh a 1-donor cohort.
4. **Quantified confidence.** Leave-one-cohort-out stability, cross-signal agreement,
   and a bootstrap over the evidence columns give per-gene P(top-K) and rank CIs.
5. **Biology gates the top.** Technical confounders are removed; a curated,
   annotation-only plausibility panel is attached. Nothing implausible earns "High".
6. **Stay stable.** `churn_vs` reports how much the top-K moves against an existing
   ranking, and `shrink` blends toward it so the published list does not thrash.

Everything is pandas/numpy and unit-testable; no single-cell dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import genesets

# Calibration-INDEPENDENT, sensor-relevant signals (all higher = better target).
# Order is priority for display only; combination is unweighted by default.
DEFAULT_SIGNALS = ("spec_score", "DSS", "Sep", "log2FC", "detect_P")

# Relative weight of each signal inside a cohort. DISEASE-specificity is what a RADAR
# sensor needs (ON in the pathogenic cell, OFF in its healthy counterpart), so the
# fold-change-based signals dominate. `Sep` is deliberately down-weighted: its off-target
# set mixes other cell types with healthy fibroblasts, so a pure cell-IDENTITY gene
# (e.g. COL1A1 in kidney: Sep 0.87 but log2FC -0.33) scores high without being
# disease-specific at all. `detect_P` is abundance, not specificity.
SIGNAL_WEIGHTS = {
    "spec_score": 1.0,   # log2FC x delta-detection — the near-binary sensor metric
    "DSS": 1.0,          # log2FC x abundance
    "log2FC": 0.8,       # raw disease fold-change
    "Sep": 0.3,          # cell-type + disease mixed -> down-weighted
    "detect_P": 0.3,     # detectability only
}

# --------------------------------------------------------------------------- #
# curated, ANNOTATION-ONLY biological plausibility panels (never quantification)
# Markers of the pathogenic cell state per disease family. Extend freely.
# --------------------------------------------------------------------------- #
_FIBROSIS_MYOFIB = {
    "POSTN", "COL1A1", "COL1A2", "COL3A1", "COL5A1", "COL5A2", "COL6A1", "COL6A2",
    "COL6A3", "COL8A1", "COL10A1", "COL11A1", "COL12A1", "COL16A1", "FN1", "CTHRC1",
    "COMP", "ASPN", "THBS1", "THBS2", "THBS4", "SPARC", "LUM", "DCN", "FBN1", "FBLN1",
    "FBLN2", "TNC", "LOX", "LOXL1", "LOXL2", "SULF1", "WISP1", "CCN4", "GREM1", "FAP",
    "PDGFRA", "PDGFRB", "ACTA2", "TAGLN", "MYH11", "TPM1", "TPM2", "ELN", "MMP2",
    "MMP11", "MMP14", "MMP23B", "TIMP1", "SERPINE1", "SERPINE2", "INHBA", "MFAP2",
    "MFAP5", "PLOD2", "CILP", "ISLR", "SFRP2", "SFRP4", "PCOLCE", "VCAN", "ADAM12",
    "CTSK", "DPT", "PCOLCE2", "NREP", "COL14A1", "OLFML2B", "PRRX1", "TWIST1",
}
_MELANOMA = {
    "PMEL", "MLANA", "TYR", "TYRP1", "DCT", "MITF", "SOX10", "PRAME", "GPNMB", "S100B",
    "CSPG4", "MCAM", "AXL", "NGFR", "EDNRB", "SERPINE2", "PLP1", "GPM6B", "MAGEA3",
    "MAGEA4", "MAGEA6", "MAGEC2", "TRPM1", "APOD", "SERPINA3", "S100A1",
}
_LIVER = {"COL1A1", "COL1A2", "COL3A1", "ACTA2", "PDGFRB", "PDGFRA", "DCN", "TIMP1",
          "LOX", "SPARC", "TAGLN", "DPT", "IGFBP7", "RGS5", "COL6A3", "MMP2", "VIM"}
_KIDNEY = {"COL1A1", "COL1A2", "COL3A1", "PDGFRB", "ACTA2", "FN1", "POSTN", "NOTCH3",
           "DCN", "LUM", "COL6A3", "SFRP2", "COL14A1", "FBLN5", "MEG3"}
_CARDIAC = {"POSTN", "COL1A1", "COL1A2", "COL3A1", "FN1", "COMP", "THBS4", "MEOX1",
            "FMOD", "DDR2", "PDGFRA", "CILP", "COL8A1", "FGF14", "GPC6"}

BIO_PANELS: dict[str, set] = {
    "fibrosis_myofibroblast": _FIBROSIS_MYOFIB,
    "melanoma": _MELANOMA,
    "liver_fibrosis": _LIVER,
    "kidney_fibrosis": _KIDNEY,
    "cardiac_fibrosis": _CARDIAC,
}

# which panels are relevant to which disease (for the plausibility gate)
DISEASE_PANELS: dict[str, tuple] = {
    "keloid": ("fibrosis_myofibroblast",),
    "pulmonary_fibrosis": ("fibrosis_myofibroblast",),
    "pan_fibrosis": ("fibrosis_myofibroblast",),
    "liver_fibrosis": ("fibrosis_myofibroblast", "liver_fibrosis"),
    "liver_cirrhosis": ("fibrosis_myofibroblast", "liver_fibrosis"),
    "kidney_fibrosis": ("fibrosis_myofibroblast", "kidney_fibrosis"),
    "cardiac_fibrosis": ("fibrosis_myofibroblast", "cardiac_fibrosis"),
    "systemic_sclerosis": ("fibrosis_myofibroblast",),
    "melanoma": ("melanoma",),
}
# any disease key containing these substrings falls back to the fibrosis panel
FIBROSIS_HINTS = ("fibrosis", "cirrhosis", "sclerosis", "keloid", "scar", "ckd", "ipf")


def _percentile(x: np.ndarray) -> np.ndarray:
    """Within-vector percentile (0-100, 100 = largest). NaNs stay NaN."""
    x = np.asarray(x, float)
    out = np.full(x.shape, np.nan)
    ok = np.isfinite(x)
    if ok.sum() == 0:
        return out
    r = pd.Series(x[ok]).rank(method="average").to_numpy()
    out[ok] = 100.0 * (r - 1) / max(len(r) - 1, 1)
    return out


def _ensure_derived(df: pd.DataFrame) -> pd.DataFrame:
    """Add DSS / spec_score if the raw columns are present but the derived ones absent.

    Keeps single-population cohorts (which lack B/H splits) usable.
    """
    df = df.copy()
    if "DSS" not in df and {"log2FC", "mean_P"}.issubset(df.columns):
        df["DSS"] = df["log2FC"].clip(lower=0) * np.log10(df["mean_P"].clip(lower=0) + 1.0)
    if "spec_score" not in df and {"log2FC", "delta_detect"}.issubset(df.columns):
        df["spec_score"] = df["log2FC"].clip(lower=0) * df["delta_detect"].clip(lower=0) / 100.0
    return df


@dataclass
class Cohort:
    label: str
    df: pd.DataFrame
    n_donors: int = 1
    weight: float = 1.0
    signals: tuple = ()
    pct: pd.DataFrame = field(default_factory=pd.DataFrame)  # gene-indexed per-signal percentiles


def prepare_cohorts(cohorts: dict[str, pd.DataFrame], signals=DEFAULT_SIGNALS,
                    drop_technical=True) -> list[Cohort]:
    """Filter technical genes and build the per-signal percentile matrix per cohort."""
    prepared = []
    for label, raw in cohorts.items():
        df = _ensure_derived(raw).dropna(subset=["gene"]).drop_duplicates("gene")
        if drop_technical:
            keep = genesets.filter_technical(df["gene"].to_numpy())
            df = df[keep]
        df = df.set_index("gene")
        present = [s for s in signals if s in df.columns and df[s].notna().any()]
        pct = pd.DataFrame({s: _percentile(df[s].to_numpy()) for s in present}, index=df.index)
        n_don = int(df["n_donors"].max()) if "n_donors" in df else 1
        prepared.append(Cohort(label=label, df=df, n_donors=max(n_don, 1),
                               weight=np.sqrt(max(n_don, 1)), signals=tuple(present), pct=pct))
    return prepared


def _evidence_matrix(prepared: list[Cohort], genes: pd.Index):
    """Stack every (cohort, signal) percentile column, aligned to ``genes``.

    Returns (E [n_genes x n_cols], col_weight [n_cols], col_cohort [n_cols]).
    Each column is one metric in one cohort; its weight is the cohort's donor weight
    divided by the number of that cohort's signals (so a cohort's total influence is
    its donor weight, split evenly across the metrics it provides).
    """
    cols, w, coh = [], [], []
    for c in prepared:
        if not c.signals:
            continue
        # weight signals by SIGNAL_WEIGHTS, renormalised so each cohort's TOTAL
        # influence stays equal to its donor weight
        sw = np.array([SIGNAL_WEIGHTS.get(s, 0.5) for s in c.signals], float)
        sw = sw / sw.sum() * c.weight
        for s, wi in zip(c.signals, sw):
            cols.append(c.pct[s].reindex(genes).to_numpy())
            w.append(float(wi))
            coh.append(c.label)
    E = np.vstack(cols).T if cols else np.empty((len(genes), 0))
    return E, np.asarray(w, float), np.asarray(coh)


def _weighted_consensus(E: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Row-wise weighted mean of finite entries. Genes with no evidence -> NaN."""
    if E.shape[1] == 0:
        return np.full(E.shape[0], np.nan)
    M = np.isfinite(E)
    W = np.where(M, w[None, :], 0.0)
    num = np.nansum(np.where(M, E, 0.0) * w[None, :], axis=1)
    den = W.sum(axis=1)
    out = np.full(E.shape[0], np.nan)
    nz = den > 0
    out[nz] = num[nz] / den[nz]
    return out


def _consensus_cov(E: np.ndarray, w: np.ndarray, coh: np.ndarray, n_total: int) -> np.ndarray:
    """Weighted-mean percentile DOWN-WEIGHTED by cohort coverage.

    coverage = 0.5 + 0.5 * (# distinct cohorts with evidence for the gene) / n_total.
    A target seen in one of three cohorts cannot outrank one reproduced in all three —
    reproducibility is the whole point of a RADAR target. Genes with no evidence: NaN.
    """
    base = _weighted_consensus(E, w)
    if E.shape[1] == 0:
        return base
    M = np.isfinite(E)
    present = np.zeros(E.shape[0])
    for c in np.unique(coh):
        present += M[:, coh == c].any(axis=1)
    coverage = 0.5 + 0.5 * present / max(n_total, 1)
    return base * coverage


def _ranks_desc(score: np.ndarray) -> np.ndarray:
    """1-based ranks, 1 = best (largest). NaN scores rank last."""
    s = np.where(np.isfinite(score), score, -np.inf)
    order = np.argsort(-s, kind="mergesort")
    ranks = np.empty(len(s), int)
    ranks[order] = np.arange(1, len(s) + 1)
    return ranks


def build_consensus(cohorts: dict[str, pd.DataFrame], disease: str = "", signals=DEFAULT_SIGNALS,
                    n_boot: int = 2000, top_k: int = 10, seed: int = 0,
                    shrink: float = 0.0, prior_rank: pd.Series | None = None) -> pd.DataFrame:
    """Aggregate cohorts into a stable, uncertainty-aware consensus ranking.

    Returns a gene-indexed DataFrame sorted by RCS (100 = best), with per-cohort
    percentiles, stability (leave-one-cohort-out), cross-signal agreement, bootstrap
    P(top-K) and rank CIs, biological plausibility, and a confidence tier.
    """
    prepared = prepare_cohorts(cohorts, signals=signals)
    n_total = len(prepared)
    genes = pd.Index(sorted(set().union(*[set(c.pct.index) for c in prepared])), name="gene")
    E, w, coh = _evidence_matrix(prepared, genes)

    consensus = _consensus_cov(E, w, coh, n_total)      # coverage-weighted mean percentile
    rcs = _percentile(consensus)                        # re-percentile to 0-100 for display
    out = pd.DataFrame(index=genes)
    out["RCS"] = rcs
    out["consensus_pct"] = consensus

    # per-cohort composite percentile (unweighted mean of that cohort's signals)
    per_cohort = {}
    for c in prepared:
        comp = c.pct.reindex(genes).mean(axis=1)        # gene composite within cohort
        per_cohort[c.label] = _percentile(comp.to_numpy())
        out[f"pct_{c.label}"] = per_cohort[c.label]
    pc = pd.DataFrame(per_cohort, index=genes)
    out["n_cohorts_present"] = pc.notna().sum(axis=1).astype(int)
    out["min_pct"] = pc.min(axis=1)                     # worst-cohort (robust)
    out["frac_top_decile"] = (pc >= 90).sum(axis=1) / pc.notna().sum(axis=1).clip(lower=1)

    # cross-cohort mean log2FC. A RADAR target must be UP in the pathogenic cells vs their
    # healthy counterpart; a gene that is merely cell-type-specific (flat or down in disease)
    # cannot be a High-confidence sensor target no matter how well it separates cell types.
    l2 = [c.df["log2FC"].reindex(genes) for c in prepared if "log2FC" in c.df.columns]
    out["log2FC_mean"] = pd.concat(l2, axis=1).mean(axis=1) if l2 else np.nan

    # --- (1) leave-one-cohort-out stability: rank spread when dropping each cohort ---
    labels = [c.label for c in prepared]
    if len(labels) >= 2:
        loco_ranks = []
        for drop in labels:
            keep = [c for c in prepared if c.label != drop]
            Ek, wk, cohk = _evidence_matrix(keep, genes)
            loco_ranks.append(_ranks_desc(_consensus_cov(Ek, wk, cohk, n_total)))
        loco = np.vstack(loco_ranks)                    # [n_drop x n_genes]
        out["loco_rank_min"] = loco.min(axis=0)
        out["loco_rank_max"] = loco.max(axis=0)
        out["loco_rank_range"] = loco.max(axis=0) - loco.min(axis=0)
    else:
        out["loco_rank_min"] = out["loco_rank_max"] = _ranks_desc(consensus)
        out["loco_rank_range"] = np.nan                 # undefined with 1 cohort

    # --- (2) cross-signal agreement: fraction of individual metrics ranking gene top-decile ---
    sig_top = np.zeros(len(genes))
    sig_n = np.zeros(len(genes))
    for j in range(E.shape[1]):
        col = E[:, j]
        ok = np.isfinite(col)
        sig_top[ok] += (col[ok] >= 90)
        sig_n[ok] += 1
    out["signal_agreement"] = np.where(sig_n > 0, sig_top / np.maximum(sig_n, 1), np.nan)
    out["n_signals"] = sig_n.astype(int)

    # --- (3) bootstrap over evidence columns -> P(top-K) and rank CI ---
    rng = np.random.default_rng(seed)
    ncol = E.shape[1]
    base_rank = _ranks_desc(consensus)
    if ncol >= 2 and n_boot > 0:
        p = w / w.sum()
        topk_hits = np.zeros(len(genes))
        rank_samples = np.empty((n_boot, len(genes)), dtype=np.int32)
        for b in range(n_boot):
            idx = rng.choice(ncol, size=ncol, replace=True, p=p)
            cons_b = _consensus_cov(E[:, idx], w[idx], coh[idx], n_total)
            rb = _ranks_desc(cons_b)
            rank_samples[b] = rb
            topk_hits += (rb <= top_k)
        out[f"p_top{top_k}"] = topk_hits / n_boot
        out["rank_ci_lo"] = np.percentile(rank_samples, 2.5, axis=0)
        out["rank_ci_hi"] = np.percentile(rank_samples, 97.5, axis=0)
    else:
        out[f"p_top{top_k}"] = (base_rank <= top_k).astype(float)
        out["rank_ci_lo"] = out["rank_ci_hi"] = base_rank

    # --- biological plausibility (annotation-only) ---
    panel_names = DISEASE_PANELS.get(disease, ())
    if not panel_names and any(h in disease.lower() for h in FIBROSIS_HINTS):
        panel_names = ("fibrosis_myofibroblast",)      # any fibrosis organ -> myofibroblast panel
    panel_union = set().union(*[BIO_PANELS[p] for p in panel_names]) if panel_names else set()
    g_up = out.index.str.upper()
    out["bio_plausible"] = g_up.isin(panel_union)
    out["is_technical"] = [genesets.is_technical(g) for g in out.index]
    out["bio_panels"] = [
        ";".join(p for p in panel_names if g.upper() in BIO_PANELS[p]) for g in out.index
    ]

    # --- optional stability shrinkage toward an existing ranking ---
    if shrink > 0 and prior_rank is not None:
        prior_pct = _percentile(-prior_rank.reindex(genes).to_numpy())  # low rank = high pct
        blended = (1 - shrink) * out["consensus_pct"].to_numpy() + shrink * prior_pct
        out["RCS"] = _percentile(blended)
        out["consensus_pct"] = blended

    # --- confidence tier (transparent, rule-based) ---
    out["confidence"] = _tier(out, top_k)
    out["rank"] = _ranks_desc(out["consensus_pct"].to_numpy())
    return out.sort_values("consensus_pct", ascending=False)


def _tier(o: pd.DataFrame, top_k: int) -> list[str]:
    """High / Medium / Low per gene from stability + agreement + biology.

    High   : top-decile consensus, agrees across >=60% of metrics, appears in >1 cohort
             (or single-cohort but bootstrap-stable), not technical, biologically plausible.
    Medium : strong data support with exactly one weakness (single cohort, or a metric
             disagrees, or not in the curated panel).
    Low    : borderline / metric- or cohort-dependent / technical.
    """
    tiers = []
    ptop = o[f"p_top{top_k}"] if f"p_top{top_k}" in o else pd.Series(0, index=o.index)
    for g, r in o.iterrows():
        strong_data = (r["consensus_pct"] >= 90) and (r.get("signal_agreement", 0) >= 0.6)
        multi = r["n_cohorts_present"] >= 2
        stable = (r.get("loco_rank_range", np.nan) <= 50) if multi else (ptop.get(g, 0) >= 0.5)
        plausible = bool(r["bio_plausible"]) and not bool(r["is_technical"])
        up_in_disease = not np.isfinite(r.get("log2FC_mean", np.nan)) or r.get("log2FC_mean", 0) > 0
        if r["is_technical"] or not up_in_disease:
            tiers.append("Low")
        elif strong_data and stable and plausible and (multi or ptop.get(g, 0) >= 0.5):
            tiers.append("High")
        elif (r["consensus_pct"] >= 80) and (strong_data or plausible):
            tiers.append("Medium")
        else:
            tiers.append("Low")
    return tiers


# --------------------------------------------------------------------------- #
# disease-level concordance diagnostics
# --------------------------------------------------------------------------- #
def concordance(out: pd.DataFrame, cohort_labels: list[str]) -> dict:
    """Mean pairwise Spearman across cohorts + Kendall's W (0-1) over per-cohort ranks."""
    from scipy.stats import spearmanr
    cols = [f"pct_{l}" for l in cohort_labels if f"pct_{l}" in out]
    if len(cols) < 2:
        return {"mean_spearman": np.nan, "kendall_w": np.nan, "n_cohorts": len(cols)}
    P = out[cols].dropna()
    rhos = [spearmanr(P[a], P[b]).correlation for i, a in enumerate(cols) for b in cols[i + 1:]]
    R = P.rank(ascending=False, axis=0)
    n, m = R.shape
    S = ((R.sum(axis=1) - m * (n + 1) / 2) ** 2).sum()
    W = 12 * S / (m ** 2 * (n ** 3 - n)) if n > 1 else np.nan
    return {"mean_spearman": float(np.nanmean(rhos)), "kendall_w": float(W), "n_cohorts": len(cols)}


def churn_vs(out: pd.DataFrame, prior_rank: pd.Series, k: int = 20) -> dict:
    """How much the new top-K differs from an existing ranking (stability check)."""
    new_top = set(out.sort_values("consensus_pct", ascending=False).head(k).index)
    old_top = set(prior_rank.sort_values().head(k).index)
    inter = len(new_top & old_top)
    union = len(new_top | old_top)
    return {"k": k, "jaccard": inter / union if union else np.nan,
            "overlap": inter / k, "entered": sorted(new_top - old_top),
            "dropped": sorted(old_top - new_top)}
