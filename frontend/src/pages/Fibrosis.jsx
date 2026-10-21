import { useNavigate } from "react-router-dom";
import FlowChrome from "../FlowChrome.jsx";
import { FIBROSIS } from "../diseases.js";
import { useGene } from "../gene-context.jsx";

export default function Fibrosis() {
  const navigate = useNavigate();
  const { setFibrosisId } = useGene();

  function pick(id) {
    setFibrosisId(id);
    navigate(`/source/${id}`);
  }

  return (
    <FlowChrome step={2}>
      <section className="flow-main">
        <p className="start-kicker">Select one</p>
        <h1>Our model ranks the best gene candidates for these types of fibrosis</h1>
        <p className="start-lead">
          Pick a disease! Then explore the top ranked fibrosis-specific genes.
        </p>
        <div className="fibro-grid">
          {FIBROSIS.map((item) => (
            <button key={item.id} type="button" className="fibro-card" onClick={() => pick(item.id)}>
              <span className="fibro-glyph">
                <img src={item.organ} alt="" />
              </span>
              <strong>{item.label}</strong>
              <span>{item.blurb}</span>
            </button>
          ))}
        </div>
      </section>
    </FlowChrome>
  );
}
