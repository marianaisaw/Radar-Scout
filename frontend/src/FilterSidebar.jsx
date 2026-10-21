import { useLocation } from "react-router-dom";
import { useGene } from "./gene-context.jsx";
import CuteLoad from "./CuteLoad.jsx";

function flip(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

const REGION_LABELS = {
  CDS: "CDS",
  "3UTR": "3′ UTR",
  "CDS-3UTR": "CDS–3′ UTR",
  "3UTR-3UTR": "3′ UTR–3′ UTR",
};

const VARIANT_LABELS = {
  CAA: "CAA",
  CCA: "CCA",
  GCA: "GCA",
  TCA: "TCA",
};

function displayOption(kind, item) {
  const key = String(item);
  if (kind === "region") return REGION_LABELS[key] || key;
  if (kind === "variant") return VARIANT_LABELS[key] || key;
  if (kind === "length") return `${key} nt`;
  return key;
}

function ChipGroup({ label, options, selected, onToggle, onAll, onNone, kind }) {
  const n = selected.length;
  return (
    <div className="field chip-box">
      <div className="chip-head">
        <span>
          {label}
          <em>
            {n}/{options.length}
          </em>
        </span>
        <span className="chip-actions">
          <button type="button" className="linkish" onClick={onAll}>
            All
          </button>
          <button type="button" className="linkish" onClick={onNone}>
            Clear
          </button>
        </span>
      </div>
      <div className="chips">
        {options.map((item) => {
          const on = selected.includes(item);
          return (
            <button
              key={item}
              className={on ? "chip on" : "chip"}
              type="button"
              title={on ? "Click to remove from the table" : "Click to add to the table"}
              onClick={() => onToggle(item)}
            >
              {displayOption(kind, item)}
              {on ? (
                <span className="x" aria-hidden="true">
                  <svg viewBox="0 0 10 10" width="8" height="8">
                    <path d="M2 2l6 6M8 2L2 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function FilterSidebar() {
  const {
    gene,
    overview,
    filters,
    setFilters,
    isoformFilter,
    setIsoformFilter,
    sort,
    setSort,
    descending,
    setDescending,
    setPage,
    isoformChoice,
  } = useGene();
  const location = useLocation();

  if (location.pathname === "/design/candidates" && !isoformChoice) {
    return null;
  }

  if (!overview || !filters) {
    return (
      <div className="side-filters">
        <h4>Filters</h4>
        {gene ? (
          <CuteLoad label={gene} />
        ) : (
          <p className="notice" style={{ padding: "4px 0" }}>
            Search a gene to filter.
          </p>
        )}
      </div>
    );
  }

  const isoforms = overview.isoforms || [];
  const selectedIsoforms = isoformFilter || isoforms;

  return (
    <div className="side-filters">
      <h4>Filters</h4>
      <p className="side-gene">{gene}</p>

      <ChipGroup
        label="Region"
        kind="region"
        options={overview.filters.region_types}
        selected={filters.region_types}
        onToggle={(item) => {
          setFilters((f) => ({ ...f, region_types: flip(f.region_types, item) }));
          setPage(1);
        }}
        onAll={() => {
          setFilters((f) => ({ ...f, region_types: overview.filters.region_types }));
          setPage(1);
        }}
        onNone={() => {
          setFilters((f) => ({ ...f, region_types: [] }));
          setPage(1);
        }}
      />

      <ChipGroup
        label="Codon"
        kind="variant"
        options={overview.filters.variants}
        selected={filters.variants}
        onToggle={(item) => {
          setFilters((f) => ({ ...f, variants: flip(f.variants, item) }));
          setPage(1);
        }}
        onAll={() => {
          setFilters((f) => ({ ...f, variants: overview.filters.variants }));
          setPage(1);
        }}
        onNone={() => {
          setFilters((f) => ({ ...f, variants: [] }));
          setPage(1);
        }}
      />

      <ChipGroup
        label="Length"
        kind="length"
        options={overview.filters.lengths}
        selected={filters.lengths}
        onToggle={(item) => {
          setFilters((f) => ({ ...f, lengths: flip(f.lengths, item) }));
          setPage(1);
        }}
        onAll={() => {
          setFilters((f) => ({ ...f, lengths: overview.filters.lengths }));
          setPage(1);
        }}
        onNone={() => {
          setFilters((f) => ({ ...f, lengths: [] }));
          setPage(1);
        }}
      />

      <ChipGroup
        label="Isoforms"
        kind="isoform"
        options={isoforms}
        selected={selectedIsoforms}
        onToggle={(item) => {
          setIsoformFilter((current) => flip(current || isoforms, item));
          setPage(1);
        }}
        onAll={() => {
          setIsoformFilter(isoforms);
          setPage(1);
        }}
        onNone={() => {
          setIsoformFilter([]);
          setPage(1);
        }}
      />

      <label className="field">
        <span>Min isoforms</span>
        <input
          type="number"
          min="1"
          value={filters.min_transcript_count}
          onChange={(e) => {
            setFilters((f) => ({ ...f, min_transcript_count: Number(e.target.value) }));
            setPage(1);
          }}
        />
      </label>

      <label className="field">
        <span>Min coverage</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={filters.min_coverage}
          onChange={(e) => {
            setFilters((f) => ({ ...f, min_coverage: Number(e.target.value) }));
            setPage(1);
          }}
        />
        <strong>{Number(filters.min_coverage).toFixed(2)}</strong>
      </label>

      <h4>Sort</h4>
      <label className="field">
        <span>Sort by</span>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          {(overview.sort_options || ["Isoform coverage"]).map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={descending}
          onChange={(e) => {
            setDescending(e.target.checked);
            setPage(1);
          }}
        />
        Descending
      </label>
    </div>
  );
}
