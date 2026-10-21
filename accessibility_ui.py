"""
Structures and Accessibility tab: RNAplfold on one isoform + a Gao candidate.

Paste the endogenous target (`candidate` column), not the RADAR `sensor`.
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

from rnaplfold.analysis import (
    calculate_accessibility_summary,
    candidate_table_view,
    available_display_lengths,
    extract_target_accessibility,
    find_best_accessible_window,
    find_best_windows_for_target,
    find_codon_sites,
    find_target_matches,
    fragment_codon_accessibility,
    summary_row,
    unpaired_columns,
)
from rnaplfold.parser import LunpParseError, parse_lunp_text
from rnaplfold.plotting import (
    plot_candidate_accessibility,
    plot_fragment_accessibility,
    plot_transcript_accessibility,
)
from rnaplfold.runner import RNAplfoldError, check_rnaplfold_installation, run_rnaplfold
from utils.fasta import (
    FastaError,
    ParsedFasta,
    normalize_sequence,
    parse_fasta,
    strip_display_ellipsis,
    validate_rna_alphabet,
)


@st.cache_data(show_spinner=False)
def cached_run_rnaplfold(
    sequence: str,
    w: int,
    l: int,
    u: int,
    transcript_id: str,
) -> tuple[pd.DataFrame, str]:
    result = run_rnaplfold(
        sequence,
        w=w,
        l=l,
        u=u,
        transcript_id=transcript_id,
    )
    accessibility = parse_lunp_text(result.lunp_text, sequence)
    return accessibility, result.version


def format_probability(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "n/a"
    return f"{value:.2f}"


def _window_label(length: int) -> str:
    if length == 1:
        return "1 nucleotide — one letter at a time"
    return f"{length} nucleotides — {length} letters in a row"


def render_accessibility_tab() -> None:
    st.write(
        "Estimate how unpaired an endogenous trigger is. Use **full transcript** "
        "when you have the isoform FASTA, or **trigger-only** to screen a pasted "
        "fragment. Full-transcript results are the ones to trust for a site; "
        "fragment-only is approximate."
    )
    with st.expander("What this tab does"):
        st.markdown(
            """
**Full transcript (recommended)**
1. Paste or upload **one** transcript FASTA (from the Ensembl tab).
2. RNAplfold predicts, for each nucleotide, how likely it is to be **unpaired**.
3. Click a **saved** RADAR candidate. The app finds that `candidate` stretch
   in the transcript and reports how open it is.

**Trigger-only fragment (screening)**
1. Paste just the trigger sequence and the 3-nt variant codon.
   Gao 90-nt rows may contain `...`; those dots are removed and the sides joined.
2. RNAplfold is run on that fragment **alone** (no surrounding mRNA).
3. The app locates the codon (and flags 0 or multiple hits) and reports
   mean unpaired probability at the codon and in a small window around it.

Numbers go from **0** (usually folded) to **1** (usually unpaired).
These compare candidates; they do not score whether a RADAR sensor will work.
            """
        )

    ok, version_or_error = check_rnaplfold_installation()
    if not ok:
        st.warning(version_or_error)

    mode = st.radio(
        "Analysis mode",
        [
            "Full transcript (recommended)",
            "Trigger-only fragment (screening)",
        ],
        horizontal=True,
        key="acc_analysis_mode",
    )
    if mode.startswith("Trigger-only"):
        _render_fragment_mode()
        return

    _render_step_transcript()
    result = st.session_state.get("acc_rnaplfold")
    if result is None:
        return

    st.divider()
    _render_step_candidate(result)
    match = _locate_candidate(result)
    st.session_state.acc_selected_match = match
    if match is not None:
        st.divider()
        _render_step_target_results(result, match)
        _render_step_transcript_map(result, match)
        _render_step_details(result, match)


def _transcript_input() -> str:
    paste_tab, upload_tab = st.tabs(["Paste FASTA", "Upload FASTA"])
    with paste_tab:
        pasted = st.text_area(
            "Full transcript FASTA",
            height=220,
            placeholder=">ENST00000375543.3\nACAAACAGTGATGG...",
            key="acc_fasta_paste",
        )
    with upload_tab:
        uploaded = st.file_uploader(
            "FASTA file",
            type=["fa", "fasta", "txt"],
            key="acc_fasta_upload",
        )
        uploaded_text = ""
        if uploaded is not None:
            uploaded_text = uploaded.getvalue().decode("utf-8", errors="replace")
            st.caption(f"Loaded {uploaded.name}")

    if uploaded_text.strip():
        return uploaded_text
    return pasted


def _rnaplfold_settings() -> tuple[int, int, int]:
    with st.expander("Advanced RNAplfold Settings", expanded=False):
        st.caption(
            "These are computational parameters for the local folding model, "
            "not biologically validated RADAR thresholds."
        )
        col_w, col_l, col_u = st.columns(3)
        with col_w:
            w = st.number_input(
                "Window size W",
                min_value=1,
                max_value=10000,
                value=200,
                step=1,
                key="acc_param_w",
                help="Local folding window size.",
            )
        if st.session_state.get("acc_param_l", 150) > w:
            st.session_state.acc_param_l = int(w)
        with col_l:
            l = st.number_input(
                "Maximum base-pair span L",
                min_value=1,
                max_value=int(w),
                value=min(150, int(w)),
                step=1,
                key="acc_param_l",
                help="Maximum base-pair span. Must be ≤ W.",
            )
        with col_u:
            u = st.number_input(
                "Maximum unpaired region u",
                min_value=1,
                max_value=200,
                value=20,
                step=1,
                key="acc_param_u",
                help=(
                    "Maximum length of contiguous unpaired sequence for which "
                    "probabilities are calculated."
                ),
            )
        st.markdown(
            "- **W**: local folding window size\n"
            "- **L**: maximum base-pair span\n"
            "- **u**: maximum length of contiguous unpaired sequence for which "
            "probabilities are calculated"
        )
    return int(w), int(l), int(u)


_FRAGMENT_ONLY_LABEL = "fragment-only (approximate, for screening)"


def _parse_trigger_fragment(text: str) -> tuple[str, dict]:
    raw = str(text or "").strip()
    if not raw:
        raise FastaError("Paste a trigger sequence.")
    if raw.startswith(">"):
        parsed = parse_fasta(raw)
        sequence, extra = strip_display_ellipsis(parsed.sequence)
        validate_rna_alphabet(sequence)
        return sequence, extra
    sequence, extra = strip_display_ellipsis(raw)
    if not sequence:
        raise FastaError("Paste a trigger sequence.")
    validate_rna_alphabet(sequence)
    return sequence, extra


def _render_fragment_mode() -> None:
    st.header("Trigger-only accessibility")
    st.info(
        f"**{_FRAGMENT_ONLY_LABEL.capitalize()}.** RNAplfold runs on the pasted "
        "trigger fragment alone, with no surrounding mRNA. Use this to screen "
        "sites quickly. It is not a substitute for full-transcript accessibility."
    )

    saved = _saved_candidates_table()
    if not saved.empty:
        labels = []
        for i, row in saved.iterrows():
            gene = str(row.get("gene", "") or "")
            variant = str(row.get("variant", "") or "")
            candidate = str(row.get("candidate", "") or "")
            preview = candidate[:18] + ("…" if len(candidate) > 18 else "")
            labels.append(f"{i + 1}: {gene} {variant} {preview}")
        chosen_label = st.selectbox(
            "Optional: fill from a saved candidate",
            labels,
            key="acc_frag_saved_label",
        )
        if st.button("Use this saved trigger", key="acc_frag_use_saved"):
            row = saved.iloc[labels.index(chosen_label)]
            st.session_state.acc_frag_trigger = str(row.get("candidate", "") or "")
            st.session_state.acc_frag_codon = str(row.get("variant", "") or "")

    trigger_text = st.text_area(
        "Trigger sequence",
        height=140,
        placeholder="Paste the endogenous trigger only. Gao 90-nt rows may include ... in the middle.",
        key="acc_frag_trigger",
    )
    codon_col, flank_col = st.columns([2, 1])
    with codon_col:
        codon_text = st.text_input(
            "Variant codon (3 nt)",
            placeholder="TCA",
            key="acc_frag_codon",
            help="The 3-nt codon to locate in the trigger, for example Gao’s variant column.",
        )
    with flank_col:
        flank = st.number_input(
            "Window around codon (± nt)",
            min_value=0,
            max_value=30,
            value=5,
            step=1,
            key="acc_frag_flank",
            help="Mean unpaired probability is also reported over this many nucleotides on each side of the codon.",
        )

    run_clicked = st.button(
        "Fold this trigger fragment",
        type="primary",
        key="acc_frag_fold",
    )
    st.caption(
        "If the paste has `...` in the middle (Gao 90-nt display format), "
        "the dots are removed and the two sides are joined."
    )
    if run_clicked:
        _run_fragment_analysis(trigger_text, codon_text, int(flank))

    stored = st.session_state.get("acc_fragment_result")
    if stored is None:
        st.caption(
            "Paste a trigger and codon, then fold. Results are "
            f"{_FRAGMENT_ONLY_LABEL}."
        )
        return
    _render_fragment_results(stored)


def _run_fragment_analysis(trigger_text: str, codon_text: str, flank: int) -> None:
    try:
        fragment, ellipsis_info = _parse_trigger_fragment(trigger_text)
        located = find_codon_sites(fragment, codon_text)
    except (FastaError, ValueError) as exc:
        st.error(str(exc))
        return

    matches = located["matches"]
    rc_matches = located["reverse_complement_matches"]
    if not matches:
        if rc_matches:
            positions = ", ".join(site.label for site in rc_matches)
            st.error(
                "That variant codon was not found in the trigger fragment "
                f"(0 hits). The reverse complement was found at {positions}."
            )
        else:
            st.error(
                "That variant codon was not found in the trigger fragment (0 hits)."
            )
        st.session_state.acc_fragment_result = None
        return

    n = len(fragment)
    w, l, u = n, n, min(20, n)
    try:
        with st.spinner(
            f"Running RNAplfold on the trigger fragment only ({n} nt)…"
        ):
            accessibility, version = cached_run_rnaplfold(
                fragment,
                w,
                l,
                u,
                "trigger_fragment",
            )
    except (RNAplfoldError, LunpParseError) as exc:
        st.error(str(exc))
        return

    st.session_state.acc_fragment_result = {
        "fragment": fragment,
        "codon": located["codon_sequence"],
        "matches": matches,
        "flank": flank,
        "accessibility": accessibility,
        "w": w,
        "l": l,
        "u": u,
        "version": version,
        "ellipsis_info": ellipsis_info,
    }


def _render_fragment_results(stored: dict) -> None:
    matches = stored["matches"]
    fragment = stored["fragment"]
    codon = stored["codon"]
    accessibility = stored["accessibility"]
    flank = int(stored["flank"])

    st.success(
        f"Folded a **{len(fragment)} nt** trigger fragment with "
        f"W={stored['w']}, L={stored['l']}, u={stored['u']}. "
        f"This is **{_FRAGMENT_ONLY_LABEL}**."
    )
    ellipsis_info = stored.get("ellipsis_info") or {}
    part_lengths = ellipsis_info.get("part_lengths") or []
    if ellipsis_info.get("had_ellipsis") and len(part_lengths) >= 2:
        joined = " + ".join(f"{n} nt" for n in part_lengths)
        st.caption(
            f"Removed `...` and joined {joined} → **{len(fragment)} nt**. "
            "That is the Gao 90-nt candidate display format, not missing RNA."
        )

    if len(matches) == 1:
        site = matches[0]
        st.info(f"Variant codon **{codon}** found once at **{site.label}**.")
    else:
        st.warning(
            f"Variant codon **{codon}** occurs **{len(matches)} times** in this "
            "fragment. Choose which occurrence to inspect."
        )
        labels = [f"Hit {i}: {site.label} ({site.sequence})" for i, site in enumerate(matches, start=1)]
        chosen = st.selectbox(
            "Which codon occurrence?",
            labels,
            key="acc_frag_occurrence",
        )
        site = matches[labels.index(chosen)]

    try:
        exposure = fragment_codon_accessibility(
            accessibility, site, flank=flank
        )
    except ValueError as exc:
        st.error(str(exc))
        return

    codon_mean = exposure.get("codon_mean_l1")
    window_mean = exposure.get("window_mean_l1")
    p_codon = exposure.get("codon_p_unpaired")
    letters = exposure.get("per_nt") or []

    st.caption(f"All numbers below are **{_FRAGMENT_ONLY_LABEL}**.")
    cards = st.columns(3)
    cards[0].metric(
        "Mean P(unpaired) at codon",
        format_probability(codon_mean),
        help="Average unpaired_l1 of the three codon nucleotides.",
    )
    cards[1].metric(
        f"Mean P(unpaired) ±{flank} nt",
        format_probability(window_mean),
        help=(
            f"Average unpaired_l1 from nt {exposure['window_start']}–"
            f"{exposure['window_end']} (codon plus {flank} nt on each side, "
            "clipped to the fragment)."
        ),
    )
    cards[2].metric(
        "P(codon unpaired)",
        format_probability(p_codon),
        help="Chance that all three codon nucleotides are unpaired together.",
    )

    if letters:
        per_cols = st.columns(len(letters))
        for i, row in enumerate(letters):
            per_cols[i].metric(
                f"{row['nt']} (nt {row['position']})",
                format_probability(row["unpaired_l1"]),
            )

    st.caption(
        f"Window used: nt {exposure['window_start']}–{exposure['window_end']} "
        f"in the {len(fragment)} nt fragment."
    )

    fig = plot_fragment_accessibility(
        accessibility,
        codon_start=site.start,
        codon_end=site.end,
        window_start=exposure["window_start"],
        window_end=exposure["window_end"],
    )
    st.plotly_chart(fig, use_container_width=True)
    st.caption(
        "Orange = variant codon; green = window around it. "
        f"{_FRAGMENT_ONLY_LABEL.capitalize()} · ViennaRNA {stored['version']}"
    )

    compact = accessibility[
        (accessibility["position"] >= exposure["window_start"])
        & (accessibility["position"] <= exposure["window_end"])
    ][["position", "nt", "unpaired_l1"]].copy()
    compact = compact.rename(
        columns={
            "position": "fragment_position",
            "unpaired_l1": "P(unpaired)",
        }
    )
    st.dataframe(compact, use_container_width=True, hide_index=True)

    if len(matches) > 1:
        st.write("All codon hits in this fragment:")
        st.dataframe(
            pd.DataFrame(
                [
                    {
                        "start": hit.start,
                        "end": hit.end,
                        "codon": hit.sequence,
                    }
                    for hit in matches
                ]
            ),
            use_container_width=True,
            hide_index=True,
        )

    summary = pd.DataFrame(
        [
            {
                "mode": _FRAGMENT_ONLY_LABEL,
                "fragment_length": len(fragment),
                "variant_codon": codon,
                "n_hits": len(matches),
                "codon_start": site.start,
                "codon_end": site.end,
                "codon_mean_unpaired_l1": codon_mean,
                "codon_p_unpaired": p_codon,
                "window_flank": flank,
                "window_start": exposure["window_start"],
                "window_end": exposure["window_end"],
                "window_mean_unpaired_l1": window_mean,
                "RNAplfold_W": stored["w"],
                "RNAplfold_L": stored["l"],
                "RNAplfold_u": stored["u"],
            }
        ]
    )
    st.download_button(
        "Download fragment-only summary CSV",
        data=summary.to_csv(index=False),
        file_name="trigger_fragment_accessibility.csv",
        mime="text/csv",
        key="acc_frag_download",
    )


def _render_step_transcript() -> None:
    st.header("1. Load the transcript")
    st.write("Paste or upload **one** isoform FASTA, then fold the full sequence.")
    fasta = _transcript_input()
    w, l, u = _rnaplfold_settings()
    run_clicked = st.button("Fold this transcript", type="primary", key="acc_fold")
    if run_clicked:
        _run_transcript_analysis(fasta, w, l, u)

    result = st.session_state.get("acc_rnaplfold")
    if result is None:
        st.caption("After folding finishes, click a saved candidate below.")
        return

    parsed: ParsedFasta = result["fasta"]
    st.success(
        f"Folded **{parsed.transcript_id}** ({parsed.length} nt) with "
        f"W={result['w']}, L={result['l']}, u={result['u']}."
    )


def _run_transcript_analysis(fasta_text: str, w: int, l: int, u: int) -> None:
    try:
        parsed = parse_fasta(fasta_text)
    except FastaError as exc:
        st.error(str(exc))
        return

    try:
        with st.spinner("Running RNAplfold on the full transcript…"):
            accessibility, version = cached_run_rnaplfold(
                parsed.sequence,
                w,
                l,
                u,
                parsed.transcript_id,
            )
    except (RNAplfoldError, LunpParseError) as exc:
        st.error(str(exc))
        return

    st.session_state.acc_rnaplfold = {
        "fasta": parsed,
        "accessibility": accessibility,
        "w": w,
        "l": l,
        "u": u,
        "version": version,
    }


def _saved_candidates_table():
    saved = st.session_state.get("favorite_rows")
    if saved is None or saved.empty or "candidate" not in saved.columns:
        return pd.DataFrame()
    return saved.reset_index(drop=True)


def _render_step_candidate(result: dict) -> None:
    parsed: ParsedFasta = result["fasta"]
    st.header("2. Choose a saved RADAR candidate")
    st.write(
        "Click a row. The **candidate** column is the endogenous target that "
        "will be located in the folded transcript (not the sensor)."
    )

    saved = _saved_candidates_table()
    if saved.empty:
        st.info(
            "No saved candidates yet. On the RADAR candidates tab, tick **save** "
            "on the rows you want, then come back here."
        )
        st.session_state.acc_selected_candidate_seq = ""
        return

    display_cols = [
        col
        for col in (
            "gene",
            "region_type",
            "variant",
            "length",
            "GC",
            "candidate",
            "matches",
            "transcript_count",
            "isoform_coverage_fraction",
        )
        if col in saved.columns
    ]
    visible = saved[display_cols].copy()
    in_isoform = []
    for seq in saved["candidate"]:
        try:
            located = find_target_matches(parsed.sequence, str(seq))
            in_isoform.append("yes" if located["matches"] else "no")
        except (FastaError, ValueError):
            in_isoform.append("no")
    visible.insert(0, "in_folded_isoform", in_isoform)

    table_event = st.dataframe(
        visible,
        key="acc_saved_pick",
        use_container_width=True,
        hide_index=True,
        on_select="rerun",
        selection_mode="single-row",
        column_config={
            "in_folded_isoform": st.column_config.TextColumn(
                "in folded isoform",
                help="yes if this Gao candidate sequence is found in the transcript you folded",
            ),
            "candidate": st.column_config.TextColumn(
                "candidate",
                help="Endogenous target sequence used for accessibility analysis",
            ),
        },
    )
    selection = table_event.get("selection")
    selected_rows = selection.get("rows", []) if selection else []
    if not selected_rows:
        st.caption("Click a row to analyze that candidate.")
        st.session_state.acc_selected_candidate_seq = ""
        return

    chosen = saved.iloc[selected_rows[0]]
    candidate_text = str(chosen.get("candidate", "") or "")
    st.session_state.acc_selected_candidate_seq = candidate_text
    st.caption(
        f"Analyzing **candidate** for {chosen.get('gene', '')} "
        f"({chosen.get('region_type', '')} | {chosen.get('variant', '')} | "
        f"{chosen.get('length', '')} nt)."
    )

    if not candidate_text.strip():
        st.error("That saved row has an empty candidate sequence.")
        return

    try:
        candidate_seq = normalize_sequence(candidate_text)
        validate_rna_alphabet(candidate_seq)
        located = find_target_matches(parsed.sequence, candidate_seq)
    except (FastaError, ValueError) as exc:
        st.error(str(exc))
        return

    st.write(f"Target length: **{located['candidate_length']} nt**")
    matches = located["matches"]
    rc_matches = located["reverse_complement_matches"]

    if not matches and rc_matches:
        positions = ", ".join(f"{m.start}–{m.end}" for m in rc_matches)
        st.error(
            "That candidate sequence was not found in the folded transcript. "
            f"The reverse complement was found at {positions}. "
            "Fold the isoform that contains this site."
        )
        return

    if not matches:
        st.error(
            "That candidate sequence was not found in this transcript. "
            "Fold an Ensembl isoform that is listed in this row’s matches column."
        )
        return

    if len(matches) == 1:
        selected = matches[0]
        st.success(
            f"Found once, at positions **{selected.start}–{selected.end}** "
            f"({selected.length} nt)."
        )
        return

    st.warning(f"{len(matches)} exact matches were found. Choose which one to inspect.")
    labels = [f"Match {i}: {m.label}" for i, m in enumerate(matches, start=1)]
    st.selectbox("Which occurrence?", labels, key="acc_candidate_occurrence")


def _render_step_target_results(result: dict, match) -> None:
    parsed: ParsedFasta = result["fasta"]
    accessibility: pd.DataFrame = result["accessibility"]
    candidate_df = extract_target_accessibility(accessibility, match.start, match.end)
    l1_summary = calculate_accessibility_summary(candidate_df)
    windows = find_best_windows_for_target(
        accessibility,
        match.start,
        match.end,
        parsed.sequence,
    )
    st.session_state.acc_candidate_analysis = {
        "df": candidate_df,
        "summary": l1_summary,
        "windows": windows,
        "sequence": normalize_sequence(
            st.session_state.get("acc_selected_candidate_seq", "")
        ),
        "match": match,
    }

    st.header("3. How open is this target?")
    st.write(
        "Higher values mean more unpaired RNA. "
        "**0** is usually folded; **1** is usually open."
    )

    best10 = windows.get(10)
    best20 = windows.get(20)
    cards = st.columns(4)
    cards[0].metric("Where it sits", f"{match.start}–{match.end}")
    cards[1].metric(
        "Average openness",
        format_probability(l1_summary["mean_unpaired_l1"]),
        help="Mean chance that each nucleotide in the target is unpaired.",
    )
    cards[2].metric(
        "Best 10-letter stretch",
        format_probability(best10.probability if best10 else None),
        help="Highest probability that 10 nucleotides in a row are all unpaired.",
    )
    cards[3].metric(
        "Best 20-letter stretch",
        format_probability(best20.probability if best20 else None),
        help="Highest probability that 20 nucleotides in a row are all unpaired.",
    )
    st.caption("These are predicted probabilities, not RADAR quality labels.")

    with st.expander("More single-nucleotide numbers"):
        stats = st.columns(4)
        stats[0].write(f"Median: **{l1_summary['median_unpaired_l1']:.2f}**")
        stats[1].write(f"Most folded nucleotide: **{l1_summary['min_unpaired_l1']:.2f}**")
        stats[2].write(f"Most open nucleotide: **{l1_summary['max_unpaired_l1']:.2f}**")
        stats[3].write(
            f"Share above 0.5: **{l1_summary['fraction_l1_above_0.5']:.0%}**"
        )
        st.caption("0.5 is only a display line, not a biology cutoff.")

    st.subheader("Target plot")
    st.write(
        "Left to right is the target itself. Up means more open, down means more folded. "
        "Start with **1 nucleotide**. Longer windows ask whether several letters in a row "
        "are all unpaired at once."
    )
    lengths = available_display_lengths(accessibility)
    selected_length = st.radio(
        "What should the line show?",
        options=lengths,
        format_func=_window_label,
        horizontal=False,
        key="acc_candidate_plot_length",
    )
    selected_window = find_best_accessible_window(
        accessibility,
        selected_length,
        match.start,
        match.end,
        parsed.sequence,
    )
    fig = plot_candidate_accessibility(
        candidate_df,
        selected_length,
        window=selected_window,
    )
    st.plotly_chart(fig, use_container_width=True)
    if selected_length == 1:
        st.caption("Each point is one nucleotide in the target.")
    else:
        st.caption(
            f"Each point is the chance that {selected_length} nucleotides ending at "
            "that position are all unpaired. The green band, if shown, is the most "
            "open stretch of that length."
        )
    if selected_window is not None and selected_length > 1:
        st.caption(
            f"Most open {selected_length}-nt stretch: transcript "
            f"{selected_window.start}–{selected_window.end} "
            f"(target positions {selected_window.candidate_start}–{selected_window.candidate_end})."
        )

    st.subheader("Most open stretches inside the target")
    st.write(
        "For each length, this is the stretch **inside your target** with the "
        "highest chance of being fully unpaired."
    )
    rows = []
    for length in (5, 10, 15, 20):
        hit = windows.get(length)
        if hit is None:
            rows.append(
                {
                    "Length": f"{length} nt",
                    "Transcript": "n/a",
                    "In target": "n/a",
                    "Sequence": "n/a",
                    "P(all unpaired)": "n/a",
                }
            )
            continue
        rows.append(
            {
                "Length": f"{length} nt",
                "Transcript": f"{hit.start}–{hit.end}",
                "In target": f"{hit.candidate_start}–{hit.candidate_end}",
                "Sequence": hit.sequence,
                "P(all unpaired)": round(hit.probability, 4),
            }
        )
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)


def _render_step_transcript_map(result: dict, match) -> None:
    parsed: ParsedFasta = result["fasta"]
    accessibility: pd.DataFrame = result["accessibility"]
    with st.expander("4. See the target on the full transcript", expanded=False):
        st.write(
            "This is the whole mRNA. The orange band is your RADAR target. "
            "You can ignore everything outside that band unless you want context."
        )
        lengths = available_display_lengths(accessibility)
        selected_length = st.radio(
            "What should this transcript line show?",
            options=lengths,
            format_func=_window_label,
            key="acc_transcript_plot_length",
        )
        fig = plot_transcript_accessibility(
            accessibility,
            selected_length,
            highlight_start=match.start,
            highlight_end=match.end,
            title=f"{parsed.transcript_id} — orange band is the target",
        )
        st.plotly_chart(fig, use_container_width=True)
        st.caption(
            f"{parsed.transcript_id} · {parsed.length} nt · "
            f"ViennaRNA {result['version']}"
        )


def _render_step_details(result: dict, match) -> None:
    analysis = st.session_state.get("acc_candidate_analysis")
    if analysis is None:
        return
    parsed: ParsedFasta = result["fasta"]
    accessibility: pd.DataFrame = result["accessibility"]
    candidate_df = analysis["df"]

    with st.expander("5. Tables and downloads"):
        st.write("Per-nucleotide values for the target only.")
        compact = candidate_table_view(candidate_df)
        st.dataframe(compact, use_container_width=True, hide_index=True)
        with st.expander("All window lengths (l = 1 … u)"):
            all_cols = [
                "candidate_position",
                "transcript_position",
                "nt",
                *unpaired_columns(candidate_df),
            ]
            st.dataframe(candidate_df[all_cols], use_container_width=True, hide_index=True)

        summary = summary_row(
            transcript_id=parsed.transcript_id,
            transcript_length=parsed.length,
            candidate_sequence=analysis["sequence"],
            match=match,
            l1_summary=analysis["summary"],
            windows=analysis["windows"],
            w=result["w"],
            l=result["l"],
            u=result["u"],
        )
        dl_cols = st.columns(2)
        with dl_cols[0]:
            st.download_button(
                "Download target summary CSV",
                data=pd.DataFrame([summary]).to_csv(index=False),
                file_name=f"{parsed.transcript_id}_candidate_accessibility.csv",
                mime="text/csv",
                key="acc_download_candidate_csv",
            )
        with dl_cols[1]:
            st.download_button(
                "Download full transcript CSV",
                data=accessibility.to_csv(index=False),
                file_name=f"{parsed.transcript_id}_transcript_accessibility.csv",
                mime="text/csv",
                key="acc_download_transcript_csv",
            )


def _locate_candidate(result: dict):
    parsed: ParsedFasta = result["fasta"]
    candidate_text = st.session_state.get("acc_selected_candidate_seq", "")
    if not str(candidate_text).strip():
        return None
    try:
        located = find_target_matches(parsed.sequence, candidate_text)
    except (FastaError, ValueError):
        return None
    matches = located["matches"]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    selected = st.session_state.get("acc_candidate_occurrence")
    labels = [f"Match {i}: {m.label}" for i, m in enumerate(matches, start=1)]
    if selected in labels:
        return matches[labels.index(selected)]
    return matches[0]
