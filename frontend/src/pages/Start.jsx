import { Link } from "react-router-dom";
import FlowChrome from "../FlowChrome.jsx";

export default function Start() {
  return (
    <FlowChrome step={1}>
      <section className="start">
        <img className="start-logo" src="/kele.png" alt="Kele, the RADAR-SCOUT mascot" />
        <p className="start-kicker">Stanford iGEM 2026</p>
        <h1>Start your RADAR design today</h1>
        <p className="start-lead">
          Rank fibrosis-specific RNA targets, then pick sensor sequences for the
          genes you want to recode and run an experimental simulation!
        </p>
        <Link className="btn start-cta" to="/fibrosis">
          Get started
        </Link>
      </section>
    </FlowChrome>
  );
}
