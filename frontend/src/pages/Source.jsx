import { useNavigate, useParams } from "react-router-dom";
import FlowChrome from "../FlowChrome.jsx";
import { fibrosisById } from "../diseases.js";
import { useGene } from "../gene-context.jsx";

function UploadIcon() {
  return (
    <svg viewBox="0 0 64 64" width="48" height="48" aria-hidden="true">
      <rect x="8" y="14" width="48" height="36" rx="8" fill="#dbe7ff" />
      <path d="M32 22v20" stroke="#14315c" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M24 30l8-8 8 8" fill="none" stroke="#14315c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Source() {
  const { disease } = useParams();
  const fibro = fibrosisById(disease);
  const navigate = useNavigate();
  const { setFibrosisId, setRankSource } = useGene();

  function usePublic() {
    setFibrosisId(fibro.id);
    setRankSource("public");
    navigate(`/ranking/${fibro.id}`);
  }

  function useOwn() {
    setFibrosisId(fibro.id);
    navigate(`/upload/${fibro.id}`);
  }

  return (
    <FlowChrome step={2} disease={fibro.id} backFallback="/fibrosis">
      <section className="flow-main source-main">
        <p className="start-kicker">Expression source</p>
        <h1>Public ranking and your RNA-seq</h1>
        <div className="source-grid">
          <article
            className="source-card source-card-default"
            role="button"
            tabIndex={0}
            onClick={usePublic}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                usePublic();
              }
            }}
          >
            <div className="source-card-top">
              <span className="source-glyph source-glyph-cellxgene">
                <img src="/cellxgene.png" alt="" />
              </span>
              <span className="source-pill">Default</span>
            </div>
            <strong>
              <a
                className="source-ext"
                href="https://cellxgene.cziscience.com/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                CELLxGENE
              </a>
              {" and "}
              <a
                className="source-ext"
                href="https://www.ncbi.nlm.nih.gov/geo/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                GEO
              </a>
            </strong>
            <p>
              Single-cell ranking for {fibro.short.toLowerCase()} fibroblasts,
              already scored on the public cohorts.
            </p>
            <span className="source-cta">Use public ranking</span>
          </article>
          <article
            className="source-card"
            role="button"
            tabIndex={0}
            onClick={useOwn}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                useOwn();
              }
            }}
          >
            <div className="source-card-top">
              <span className="source-glyph source-glyph-alt">
                <UploadIcon />
              </span>
            </div>
            <strong>Your RNA-seq</strong>
            <p>
              A zip of bulk results. We score the expression matrix inside.
            </p>
            <span className="source-cta source-cta-ghost">Upload a zip</span>
          </article>
        </div>
      </section>
    </FlowChrome>
  );
}
