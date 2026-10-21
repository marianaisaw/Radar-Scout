import { useNavigate } from "react-router-dom";
import { useGene } from "../gene-context.jsx";
import IsoformExpression from "../IsoformExpression.jsx";

export default function Isoforms() {
  const { setIsoformFilter, setIsoformChoice } = useGene();
  const navigate = useNavigate();

  return (
    <IsoformExpression
      footer={({ ids }) => (
        <button
          className="btn"
          type="button"
          disabled={!ids.length}
          onClick={() => {
            setIsoformFilter(ids.length ? ids : []);
            setIsoformChoice("expressed");
            navigate("/design/candidates");
          }}
        >
          Use these isoforms
        </button>
      )}
    />
  );
}
