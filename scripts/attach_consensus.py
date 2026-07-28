"""Attach the RADAR Consensus Score (RCS) + confidence onto the dashboard JSON.

Run AFTER scripts/build_dashboard_data.py. Non-destructive: for every disease that
has both a pooled dashboard file and a consensus parquet, it merges RCS / confidence /
P(top-10) / stability onto the pooled genes so the app can show a "Consensus" lens and
a confidence badge. Fully manifest-driven — each organ fibrosis is handled separately
(no pooling across organs).

    python scripts/build_consensus.py && python scripts/attach_consensus.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "outputs"
DATA = ROOT / "dashboard" / "public" / "data"

FIELDS = {
    "RCS": ("RCS", 1), "confidence": ("confidence", None), "p_top10": ("p_top10", 2),
    "signal_agreement": ("signal_agreement", 2), "n_cohorts_present": ("n_cohorts_present", 0),
    "frac_top_decile": ("frac_top_decile", 2), "loco_rank_range": ("loco_rank_range", 0),
    "rank_ci_lo": ("rank_ci_lo", 0), "rank_ci_hi": ("rank_ci_hi", 0),
    "bio_panels": ("bio_panels", None), "bio_plausible": ("bio_plausible", None),
}


def _clean(v, nd):
    if isinstance(v, str):
        return v
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return None
    return int(round(v)) if nd == 0 else round(float(v), nd)


def main():
    print("attaching consensus + confidence to dashboard data:")
    n = 0
    for cons_path in sorted(OUT.glob("*_consensus.parquet")):
        key = cons_path.name[: -len("_consensus.parquet")]
        pooled = DATA / f"{key}_pooled_racs.json"
        if not pooled.exists():
            print(f"  skip {key}: no {pooled.name} (not in dashboard yet)")
            continue
        cons = pd.read_parquet(cons_path).set_index("gene")
        rows = json.loads(pooled.read_text())
        hit = 0
        for r in rows:
            g = r.get("gene")
            if g in cons.index:
                hit += 1
                for col, (jkey, nd) in FIELDS.items():
                    if col in cons.columns:
                        r[jkey] = _clean(cons.at[g, col], nd)
        pooled.write_text(json.dumps(rows))
        n += 1
        tiers = cons["confidence"].value_counts().to_dict()
        print(f"  {key}: enriched {hit}/{len(rows)} genes  (tiers {tiers})")
    print(f"done — {n} diseases enriched.")


if __name__ == "__main__":
    main()
