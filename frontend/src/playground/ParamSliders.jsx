import CollapsibleSection from "../scout/components/CollapsibleSection.jsx";
import { PARAMS, PARAM_GROUPS, fieldActive } from "./schema.js";

function stepFor(field) {
  if (field.step) return Number(field.step);
  const span = (field.max ?? 1) - (field.min ?? 0);
  if (span <= 2) return 0.01;
  if (span <= 20) return 0.05;
  return 0.1;
}

function presetValue(field, delivery) {
  if (field.byAgent && field.byAgent[delivery] != null) return field.byAgent[delivery];
  return Number(field.default);
}

export default function ParamSliders({ model, params, onChange, onRevert }) {
  return (
    <>
      {PARAM_GROUPS.map((group) => {
        const fields = PARAMS.filter((field) => field.group === group.id && fieldActive(field, model));
        if (!fields.length) return null;
        return (
          <CollapsibleSection
            key={group.id}
            title={group.label}
            defaultOpen={group.id === "delivery"}
            hint={`${fields.length}`}
          >
            {fields.map((field) => {
              const value = Number(params[field.name] ?? field.default);
              const preset = presetValue(field, model.delivery);
              const modified = Math.abs(value - preset) > 1e-9;
              return (
                <div className="pg-slider" key={field.name}>
                  <div className="pg-slider-head">
                    <label htmlFor={`pg-${field.name}`}>
                      {field.label}
                      {field.unit ? <span className="pg-unit"> {field.unit}</span> : null}
                    </label>
                    {modified ? (
                      <button type="button" className="pg-revert" onClick={() => onRevert(field.name, preset)}>
                        modified
                      </button>
                    ) : null}
                  </div>
                  <input
                    id={`pg-${field.name}`}
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={stepFor(field)}
                    value={value}
                    onChange={(e) => onChange(field.name, Number(e.target.value))}
                  />
                  <input
                    className="pg-num"
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={stepFor(field)}
                    value={Number.isFinite(value) ? value : ""}
                    onChange={(e) => onChange(field.name, Number(e.target.value))}
                  />
                </div>
              );
            })}
          </CollapsibleSection>
        );
      })}
    </>
  );
}
