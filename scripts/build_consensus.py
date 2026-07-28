"""Build the RADAR Consensus Score (RCS) per disease from scored cohort parquets.

Manifest-driven: discovers every disease and its cohorts from outputs/manifest.json
(plus the non-manifest keloid GEO/Deng cohorts), so each organ fibrosis that gets
ingested automatically gets its own SEPARATE consensus analysis — no pooling across
organs. For each disease writes outputs/<key>_consensus.parquet + .csv and prints a
confidence report (cross-cohort concordance, top targets + tiers, churn vs current).

    python scripts/build_consensus.py                 # all discovered diseases
    python scripts/build_consensus.py keloid liver_fibrosis
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from radar_scout import consensus as C  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs"

# keloid cohorts that live outside manifest.json (wired into the dashboard build by hand)
EXTRA = {"keloid": {"GEO": "keloid_geo", "DengMFB": "keloid_deng_mfb"}}
EXCLUDE = {"keloid_v2",          # superseded weak whole-fibroblast run
           "skin_scleroderma",   # only 6 disease donors -> housekeeping noise, not fibrosis
           "melanoma_7b20c613", "melanoma_b617ee1b"}  # per-dataset splits overlap melanoma_malignant

SHOW = ["RCS", "n_cohorts_present", "frac_top_decile", "signal_agreement",
        "p_top10", "rank_ci_lo", "rank_ci_hi", "confidence", "bio_panels"]


def discover() -> dict:
    """disease_key -> {cohort_label: parquet_path}, from manifest + extras, existing only."""
    diseases: dict = {}
    man = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else {"diseases": []}
    for d in man.get("diseases", []):
        if d["out_name"] in EXCLUDE:
            continue
        key = d["disease"].replace(" ", "_")
        diseases.setdefault(key, {})[d["out_name"]] = OUT / f"{d['out_name']}_racs.parquet"
    for key, cohorts in EXTRA.items():
        for label, out_name in cohorts.items():
            diseases.setdefault(key, {})[label] = OUT / f"{out_name}_racs.parquet"
    # keep only cohorts whose parquet exists; drop diseases with none
    out = {}
    for key, cohorts in diseases.items():
        present = {lab: p for lab, p in cohorts.items() if Path(p).exists()}
        if present:
            out[key] = present
    return out


def run(disease_key: str, spec: dict) -> pd.DataFrame:
    cohorts = {lab: pd.read_parquet(p) for lab, p in spec.items()}
    labels = list(cohorts)
    primary = cohorts[labels[0]].dropna(subset=["gene"]).drop_duplicates("gene").set_index("gene")
    prior_rank = primary["RACS"].rank(ascending=False, method="min")

    out = C.build_consensus(cohorts, disease=disease_key, n_boot=2000, top_k=10, seed=0)
    conc = C.concordance(out, labels)
    churn = C.churn_vs(out, prior_rank, k=20)

    print("=" * 78)
    print(f"[{disease_key}]  {len(labels)} cohorts: {labels}")
    if conc["n_cohorts"] >= 2:
        print(f"  cross-cohort concordance: mean Spearman={conc['mean_spearman']:.3f}  "
              f"Kendall W={conc['kendall_w']:.3f}")
    else:
        print("  SINGLE COHORT — confidence capped at Medium until a 2nd cohort is ingested.")
    print(f"  confidence tiers: {out['confidence'].value_counts().to_dict()}")
    print(f"  stability vs current RACS top-20: overlap={churn['overlap']:.0%}")
    top = out.head(12)[SHOW].copy()
    for c in ("RCS",):
        top[c] = top[c].round(1)
    for c in ("p_top10", "signal_agreement", "frac_top_decile"):
        top[c] = top[c].round(2)
    for c in ("rank_ci_lo", "rank_ci_hi"):
        top[c] = top[c].astype(int)
    print(top.to_string())
    print()

    out.reset_index().to_parquet(OUT / f"{disease_key}_consensus.parquet", index=False)
    out.reset_index().to_csv(OUT / f"{disease_key}_consensus.csv", index=False)
    return out


def main():
    discovered = discover()
    wanted = sys.argv[1:] or list(discovered)
    print(f"discovered diseases: {list(discovered)}")
    for d in wanted:
        if d not in discovered:
            print(f"  (no cohorts for {d}; known: {list(discovered)})")
            continue
        run(d, discovered[d])
    print("wrote outputs/<disease>_consensus.parquet + .csv")


if __name__ == "__main__":
    main()
