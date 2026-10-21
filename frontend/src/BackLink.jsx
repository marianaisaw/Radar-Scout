import { useNavigate } from "react-router-dom";

export default function BackLink({ fallback = "/", label = "Back" }) {
  const navigate = useNavigate();

  function goBack() {
    const idx = window.history.state?.idx;
    if (typeof idx === "number" && idx > 0) navigate(-1);
    else navigate(fallback);
  }

  return (
    <button type="button" className="back-link" onClick={goBack}>
      ← {label}
    </button>
  );
}
