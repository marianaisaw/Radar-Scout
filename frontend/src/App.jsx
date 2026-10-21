import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { GeneContext } from "./gene-context.jsx";
import FilterSidebar from "./FilterSidebar.jsx";
import Overview from "./pages/Overview.jsx";
import Candidates from "./pages/Candidates.jsx";
import Isoforms from "./pages/Isoforms.jsx";
import Transcripts from "./pages/Transcripts.jsx";
import Accessibility from "./pages/Accessibility.jsx";
import Sensor from "./pages/Sensor.jsx";
import Saved from "./pages/Saved.jsx";
import Start from "./pages/Start.jsx";
import Fibrosis from "./pages/Fibrosis.jsx";
import Ranking from "./pages/Ranking.jsx";
import Source from "./pages/Source.jsx";
import Upload from "./pages/Upload.jsx";
import Playground from "./pages/Playground.jsx";
import { DEFAULT_MODEL } from "./playground/schema.js";
import { fibrosisById, organSrc } from "./diseases.js";
import BackLink from "./BackLink.jsx";

function Icon({ name }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" };
  if (name === "home") {
    return (
      <svg {...common}>
        <path d="M2.5 7.2 8 2.8l5.5 4.4V14H10V9.4H6V14H2.5V7.2Z" />
      </svg>
    );
  }
  if (name === "table") {
    return (
      <svg {...common}>
        <rect x="2" y="3" width="12" height="10" rx="2" />
        <path d="M2 7h12M8 3v10" />
      </svg>
    );
  }
  if (name === "bars") {
    return (
      <svg {...common}>
        <path d="M3 12V8M8 12V4M13 12V6" />
      </svg>
    );
  }
  if (name === "dna") {
    return (
      <svg {...common}>
        <path d="M4 3c4 3 4 7 0 10M12 3C8 6 8 10 12 13M5.2 6.2h5.6M5.2 9.8h5.6" />
      </svg>
    );
  }
  if (name === "wave") {
    return (
      <svg {...common}>
        <path d="M2 10c2-6 3 4 5 0s3 6 5 0 2 4 2 4" />
      </svg>
    );
  }
  if (name === "fold") {
    return (
      <svg {...common}>
        <path d="M3 12c2-8 8-8 10 0M5 8.5a3 3 0 0 0 6 0" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M8 2.6 9.5 6h3.7L10.6 8.4 12 12 8 9.8 4 12l1.4-3.6L2.8 6h3.7L8 2.6Z" />
    </svg>
  );
}

const NAV = [
  ["/design", "Overview", "home"],
  ["/design/candidates", "Candidates", "table"],
  ["/design/isoforms", "Isoforms", "bars"],
  ["/design/transcripts", "Transcripts", "dna"],
  ["/design/accessibility", "Accessibility", "wave"],
  ["/design/sensor", "Sensor fold", "fold"],
  ["/design/saved", "Saved", "star"],
];

const SIDEBAR_MIN = 180;
const SIDEBAR_DEFAULT = 320;

function clampSidebar(width) {
  const max = Math.max(SIDEBAR_MIN, Math.round((typeof window === "undefined" ? 1200 : window.innerWidth) * 0.8));
  return Math.min(max, Math.max(SIDEBAR_MIN, Math.round(width)));
}

function loadSidebarWidth() {
  const n = Number(localStorage.getItem("radar-sidebar-width"));
  if (!Number.isFinite(n) || n <= 280) return SIDEBAR_DEFAULT;
  return clampSidebar(n);
}

const TITLES = {
  "/design": "Overview",
  "/design/candidates": "Candidates",
  "/design/isoforms": "Isoforms",
  "/design/transcripts": "Transcripts",
  "/design/accessibility": "Accessibility",
  "/design/sensor": "Sensor fold",
  "/design/saved": "Saved",
};

export default function App() {
  const [gene, setGene] = useState("ADAM12");
  const [draft, setDraft] = useState("ADAM12");
  const [suggestions, setSuggestions] = useState([]);
  const [overview, setOverview] = useState(null);
  const [isoformFilter, setIsoformFilter] = useState(null);
  const [filters, setFilters] = useState(null);
  const [sort, setSort] = useState("Isoform coverage");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(1);
  const [geneError, setGeneError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [fibrosisId, setFibrosisId] = useState("keloid");
  const [isoformChoice, setIsoformChoice] = useState(null);
  const [geneAlias, setGeneAlias] = useState(null);
  const [bulkCohort, setBulkCohort] = useState(null);
  const [rankSource, setRankSource] = useState("public");
  const [playgroundModel, setPlaygroundModel] = useState(DEFAULT_MODEL);
  const [playgroundCandidate, setPlaygroundCandidate] = useState(null);
  const dragRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const pageTitle = TITLES[location.pathname] || "RADAR-SCOUT";
  const inDesign = location.pathname.startsWith("/design");

  function openGene(name) {
    const next = String(name || "").trim().toUpperCase();
    if (!next) return;
    setDraft(next);
    if (next !== gene) {
      setGene(next);
      setGeneAlias(null);
      setOverview(null);
      setIsoformFilter(null);
      setIsoformChoice(null);
      setFilters(null);
      setPage(1);
    }
  }

  const value = useMemo(
    () => ({
      gene,
      setGene,
      draft,
      setDraft,
      openGene,
      fibrosisId,
      setFibrosisId,
      overview,
      setOverview,
      isoformFilter,
      setIsoformFilter,
      isoformChoice,
      setIsoformChoice,
      filters,
      setFilters,
      sort,
      setSort,
      descending,
      setDescending,
      page,
      setPage,
      geneError,
      geneAlias,
      bulkCohort,
      setBulkCohort,
      rankSource,
      setRankSource,
      playgroundModel,
      setPlaygroundModel,
      playgroundCandidate,
      setPlaygroundCandidate,
    }),
    [gene, draft, fibrosisId, overview, isoformFilter, isoformChoice, filters, sort, descending, page, geneError, geneAlias, bulkCohort, rankSource, playgroundModel, playgroundCandidate]
  );

  function submitGene(event) {
    event?.preventDefault();
    const next = draft.trim().toUpperCase();
    if (!next) return;
    if (next !== gene) {
      setGene(next);
      setGeneAlias(null);
      setOverview(null);
      setIsoformFilter(null);
      setIsoformChoice(null);
      setFilters(null);
      setPage(1);
    }
    setMenuOpen(false);
    navigate("/design/candidates");
  }

  useEffect(() => {
    let cancelled = false;
    setGeneError("");
    api
      .overview(gene)
      .then((data) => {
        if (cancelled) return;
        if (data.aliased_from) {
          setGeneAlias({ from: data.aliased_from, to: data.gene });
        }
        if (data.gene && data.gene.toUpperCase() !== gene.toUpperCase()) {
          setGene(data.gene);
          setDraft(data.gene);
        }
        setOverview(data);
        setFilters({
          region_types: data.filters.region_types,
          variants: data.filters.variants,
          lengths: data.filters.lengths,
          min_transcript_count: 1,
          min_coverage: 0,
        });
        setIsoformFilter((current) => current ?? data.isoforms);
        setPage(1);
      })
      .catch((err) => {
        if (!cancelled) {
          setOverview(null);
          setFilters(null);
          setGeneError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gene, setOverview, setIsoformFilter]);

  useEffect(() => {
    if (!draft.trim()) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(() => {
      api.suggest(draft).then((data) => setSuggestions(data.genes || [])).catch(() => {});
    }, 180);
    return () => clearTimeout(handle);
  }, [draft]);

  useEffect(() => {
    localStorage.setItem("radar-sidebar-hidden", sidebarHidden ? "1" : "0");
  }, [sidebarHidden]);

  function isMobileNav() {
    return window.matchMedia("(max-width: 1100px)").matches;
  }

  function toggleSidebar() {
    if (isMobileNav()) {
      setMenuOpen((open) => !open);
      return;
    }
    setSidebarHidden((hidden) => !hidden);
    setMenuOpen(false);
  }

  function startResize(event) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    dragRef.current = { startX, startWidth };
    setResizing(true);

    function onMove(moveEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      setSidebarWidth(clampSidebar(drag.startWidth + moveEvent.clientX - drag.startX));
    }

    function onUp() {
      dragRef.current = null;
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSidebarWidth((width) => {
        localStorage.setItem("radar-sidebar-width", String(width));
        return width;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const design = (
    <>
      <div className={`scrim ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)} />
      <div
        className={`app${sidebarHidden ? " sidebar-hidden" : ""}${resizing ? " resizing" : ""}`}
        style={{ "--sidebar": `${sidebarWidth}px` }}
      >
        <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
          <div className="brand">
            <div className="logo">
              <img src={organSrc(fibrosisId)} alt="" />
            </div>
            <div>
              <h1>RADAR-SCOUT</h1>
              <small>Stanford iGEM 2026</small>
            </div>
            <button
              className="sidebar-hide"
              type="button"
              title="Hide sidebar"
              onClick={() => {
                setMenuOpen(false);
                setSidebarHidden(true);
              }}
            >
              Hide
            </button>
          </div>
          <nav className="nav">
            {NAV.map(([to, label, icon]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/design"}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <span className="nav-icon">
                  <Icon name={icon} />
                </span>
                {label}
              </NavLink>
            ))}
          </nav>
          <FilterSidebar />
          <div className="promo">
            <a href="https://2026.igem.wiki/stanford/" target="_blank" rel="noreferrer">
              Wiki
            </a>
          </div>
          <div
            className="sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize"
            onPointerDown={startResize}
            onDoubleClick={() => {
              setSidebarWidth(SIDEBAR_DEFAULT);
              localStorage.setItem("radar-sidebar-width", String(SIDEBAR_DEFAULT));
            }}
          />
        </aside>
        <main className="main">
          <div className="topbar">
            <div className="hello">
              <button
                className="menu-btn"
                type="button"
                title="Show sidebar"
                onClick={toggleSidebar}
              >
                ☰
              </button>
              <BackLink fallback={fibrosisId ? `/ranking/${fibrosisId}` : "/fibrosis"} />
              <h2>{pageTitle}</h2>
              {fibrosisId ? (
                <Link className="flow-mini" to={`/ranking/${fibrosisId}`}>
                  {fibrosisById(fibrosisId).label}
                </Link>
              ) : null}
            </div>
            <form className="search" onSubmit={submitGene}>
              <span>⌕</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Search a gene"
                list="gene-suggest"
              />
              <datalist id="gene-suggest">
                {suggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </form>
          </div>
          <Routes>
            <Route path="/design" element={<Overview onSearch={submitGene} draft={draft} setDraft={setDraft} />} />
            <Route path="/design/candidates" element={<Candidates />} />
            <Route path="/design/isoforms" element={<Isoforms />} />
            <Route path="/design/transcripts" element={<Transcripts />} />
            <Route path="/design/accessibility" element={<Accessibility />} />
            <Route path="/design/sensor" element={<Sensor />} />
            <Route path="/design/saved" element={<Saved />} />
          </Routes>
        </main>
      </div>
    </>
  );

  return (
    <GeneContext.Provider value={value}>
      {inDesign ? (
        design
      ) : (
        <Routes>
          <Route path="/" element={<Start />} />
          <Route path="/fibrosis" element={<Fibrosis />} />
          <Route path="/source/:disease" element={<Source />} />
          <Route path="/upload/:disease" element={<Upload />} />
          <Route path="/ranking/:disease" element={<Ranking />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </GeneContext.Provider>
  );
}
