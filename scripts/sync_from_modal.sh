#!/bin/bash
# Pull every scored cohort from the Modal volume and REBUILD manifest.json from the
# per-cohort meta files (the volume manifest.json is unreliable under concurrent
# ingests — each writer clobbers the others). Then rebuild the per-organ dashboard.
set -e
cd "$(dirname "$0")/.."
source .venv/bin/activate 2>/dev/null || true

echo "== list scored cohorts on the volume =="
modal volume ls radar-scout-data 2>/dev/null | grep -oE '[a-z_0-9]+_racs\.parquet' | sort -u \
  | sed 's/_racs\.parquet//' > /tmp/radar_cohorts.txt
echo "found $(wc -l < /tmp/radar_cohorts.txt) cohorts"

echo "== pull parquet + meta for each =="
while read on; do
  for suf in _racs.parquet _meta.json _umap.parquet; do
    modal volume get --force radar-scout-data "${on}${suf}" outputs/ >/dev/null 2>&1 || true
  done
done < /tmp/radar_cohorts.txt

echo "== reconstruct manifest.json from meta files =="
python3 - <<'PY'
import json, glob, os
# cohorts to keep out of the dashboard (superseded / weak / non-fibrosis splits)
DROP = {"keloid_v2", "keloid_skinfibro", "skin_scleroderma",
        "melanoma_7b20c613", "melanoma_b617ee1b",
        "keloid_geo",          # added via build_dashboard_data's hardcoded extras (avoid dup)
        # --- NOT FIBROSIS: purged. Disease label != fibrosis pathology. ---
        "heart_chaffin",       # congenital heart disease atlas (ToF, HLHS) — not fibrosis
        "heart_periheart",     # coronary artery + heart VALVE disorder (atrial) — not fibrosis
        "heart_carebank",      # heart valve disorder + ischemia (atrial) — not fibrosis
        "liver_cholangitis", "liver_cholangitis_sc",  # biliary cholangiopathy (PBC/PSC), not liver fibrosis
        "lung_ild",            # coarse "interstitial lung disease": includes sarcoidosis/anthracosis
                               # -> replaced by lung_vannan_ipf (Diagnosis == IPF)
        "lung_reyfman",        # batch-confounded: top hits are housekeeping (HMGB1/CFL1/PKM/UQCRB)
                               # at Sep~1.0 => depth artifact between IPF and Donor runs, not biology
        "ssc_ild_valenzi"}     # GSE128169: 6/20 top genes are housekeeping (HLA-A/H3F3A/COX4I1/PARK7)
                               # -> chemistry/batch artifact (controls re-used from GSE128033), not SSc biology
diseases = []
for mf in sorted(glob.glob('outputs/*_meta.json')):
    on = os.path.basename(mf)[:-len('_meta.json')]
    if on in DROP or not os.path.exists(f'outputs/{on}_racs.parquet'):
        continue
    try:
        m = json.load(open(mf))
    except Exception:
        continue
    dz = m.get('disease')
    if not dz:
        continue
    # never fall back to the cohort/out_name — it renders as a bogus "cell type" pill
    ct = m.get('pathogenic_cell_types') or m.get('cell_type') or 'Fibroblast / myofibroblast'
    if isinstance(ct, list):
        ct = ', '.join(ct)
    nd = m.get('n_donors', {})
    diseases.append({
        'disease': dz, 'out_name': on, 'cell_type': str(ct),
        'n_genes': int(m.get('n_candidate_genes', 0)),
        'n_donors_P': int(nd.get('P', 0)) if isinstance(nd, dict) else 0,
        'reference_pop': m.get('reference_pop', 'H'), 'has_umap': bool(m.get('has_umap', False)),
    })
json.dump({'diseases': diseases}, open('outputs/manifest.json', 'w'), indent=2)
from collections import Counter
c = Counter(d['disease'] for d in diseases)
print('manifest rebuilt:', dict(c))
PY

echo "== rebuild dashboard data =="
python3 scripts/build_dashboard_data.py 2>&1 | tail -3
echo "== per-organ consensus =="
python3 scripts/build_consensus.py 2>&1 | grep -E 'discovered|cohorts:|concordance|SINGLE|tiers'
echo "== attach consensus + confidence =="
python3 scripts/attach_consensus.py 2>&1 | tail -12
echo "DONE"
