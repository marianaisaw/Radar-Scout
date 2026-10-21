import {
  CELL_TYPES,
  CO_FORMULATION,
  DOSE_UNITS,
  WELL_FORMATS,
  cargoPerCellPg,
  carrierRatioUnit,
  fieldActive,
  CONDITIONS,
} from "./schema.js";

function parseTimes(text) {
  return String(text)
    .split(/[,\s]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function Field({ label, span, children }) {
  return (
    <label className={`field${span ? ` span-${span}` : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function ConditionsPanel({ model, conditions, onChange }) {
  const cell = CELL_TYPES.find((row) => row.id === conditions.cell_type);
  const well = WELL_FORMATS.find((row) => row.id === conditions.well_format);
  const pg = cargoPerCellPg(conditions);
  const showAnd = fieldActive(
    CONDITIONS.find((field) => field.name === "co_formulation"),
    model
  );

  function set(name, value) {
    const next = { ...conditions, [name]: value };
    if (name === "well_format") {
      const picked = WELL_FORMATS.find((row) => row.id === value);
      if (picked) next.seeding_cells = picked.typical_cells;
    }
    onChange(next);
  }

  return (
    <div className="pg-block">
      <p className="pg-kicker">Experimental conditions</p>
      <div className="pg-fields">
        <Field label="Cell type" span={2}>
          <select value={conditions.cell_type} onChange={(e) => set("cell_type", e.target.value)}>
            {CELL_TYPES.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
                {row.arm === "P" ? " · P" : row.arm === "H" ? " · H" : " · lab"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Dose">
          <input
            type="number"
            min={1}
            max={5000}
            value={conditions.dose ?? ""}
            onChange={(e) => set("dose", Number(e.target.value))}
          />
        </Field>
        <Field label="Unit">
          <select value={conditions.dose_unit} onChange={(e) => set("dose_unit", e.target.value)}>
            {DOSE_UNITS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.id === "ug" ? "µg" : "ng"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Well">
          <select value={conditions.well_format} onChange={(e) => set("well_format", e.target.value)}>
            {WELL_FORMATS.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Ratio (${carrierRatioUnit(model.delivery)})`}>
          <input
            type="number"
            min={0.5}
            max={20}
            step={0.5}
            value={conditions.carrier_ratio ?? ""}
            onChange={(e) => set("carrier_ratio", Number(e.target.value))}
          />
        </Field>
        <Field label="Cells / well">
          <input
            type="number"
            min={1000}
            max={1e6}
            step={1000}
            value={conditions.seeding_cells ?? ""}
            onChange={(e) => set("seeding_cells", Number(e.target.value))}
          />
        </Field>
        <Field label="Confluence">
          <input
            type="number"
            min={0.2}
            max={1}
            step={0.05}
            value={conditions.confluence ?? ""}
            onChange={(e) => set("confluence", Number(e.target.value))}
          />
        </Field>
        <div className="field">
          <span>Serum</span>
          <div className="chips">
            <button type="button" className={`chip${conditions.serum ? "" : " on"}`} onClick={() => set("serum", false)}>
              No
            </button>
            <button type="button" className={`chip${conditions.serum ? " on" : ""}`} onClick={() => set("serum", true)}>
              Yes
            </button>
          </div>
        </div>
        <Field label="Harvest (h)">
          <input
            value={Array.isArray(conditions.harvest_h) ? conditions.harvest_h.join(", ") : conditions.harvest_h ?? ""}
            onChange={(e) => set("harvest_h", parseTimes(e.target.value))}
            placeholder="24, 48"
          />
        </Field>
        {showAnd ? (
          <Field label="AND mixing" span={2}>
            <select
              value={conditions.co_formulation}
              onChange={(e) => set("co_formulation", e.target.value)}
            >
              {CO_FORMULATION.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
      <p className="pg-derived">
        ≈ {pg.toFixed(1)} pg / cell
        {cell ? ` · ${Math.round(cell.transfection_efficiency * 100)}% tx` : ""}
        {well ? ` · ${well.volume_ul} µL` : ""}
      </p>
    </div>
  );
}
