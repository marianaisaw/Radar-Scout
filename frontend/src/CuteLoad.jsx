import { organSrc } from "./diseases.js";
import { useGene } from "./gene-context.jsx";

export default function CuteLoad({ label = "Finding sensors…" }) {
  const ctx = useGene();
  const src = organSrc(ctx?.fibrosisId);
  return (
    <div className="cute-load" role="status" aria-live="polite">
      <div className="cute-load-orb">
        <span className="cute-load-ring" aria-hidden="true" />
        <img src={src} alt="" />
      </div>
      <p>{label}</p>
    </div>
  );
}
