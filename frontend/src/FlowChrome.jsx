import { Link } from "react-router-dom";
import { fibrosisById, organSrc } from "./diseases.js";
import BackLink from "./BackLink.jsx";

export default function FlowChrome({ step, disease, children, wide = false, backFallback }) {
  const info = disease ? fibrosisById(disease) : null;
  const fallback = backFallback || (step >= 3 ? (disease ? `/source/${disease}` : "/fibrosis") : "/");
  return (
    <div className={`flow${wide ? " ranking-flow" : ""}`}>
      <header className="flow-bar">
        <div className="flow-bar-left">
          {step > 1 ? <BackLink fallback={fallback} /> : null}
          <Link to="/" className="flow-brand">
            <img src={disease ? organSrc(disease) : "/kele.png"} alt="" />
            <span>RADAR-SCOUT</span>
          </Link>
        </div>
        <ol className="flow-steps">
          <li className={step >= 1 ? "on" : ""}>
            {step > 1 ? <Link to="/">Start</Link> : "Start"}
          </li>
          <li className={step >= 2 ? "on" : ""}>
            {step > 2 ? <Link to="/fibrosis">Fibrosis</Link> : "Fibrosis"}
          </li>
          <li className={step >= 3 ? "on" : ""}>Ranking</li>
          <li className={step >= 4 ? "on" : ""}>
            {step > 3 ? <Link to="/design/candidates">Sensors</Link> : "Sensors"}
          </li>
          <li className={step >= 5 ? "on" : ""}>
            {step >= 5 ? "Playground" : <Link to="/playground">Playground</Link>}
          </li>
        </ol>
        {info ? <span className="flow-tag">{info.label}</span> : <span />}
      </header>
      {children}
    </div>
  );
}
