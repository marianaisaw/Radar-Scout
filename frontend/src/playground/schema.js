/**
 * Single data-driven schema for the experimental-validation playground.
 * Screens render from this file. Adding a parameter or condition later
 * should only require an edit here, not in a React component.
 *
 * Request:  { delivery, system, logic, conditions, params, triggerLevels, tSpan }
 * Response: { t[], states{ name: number[] }, observables{ foldChange, leak,
 *             tHalf, peakOutput }, truthTable? }
 */

/**
 * @typedef {"lipoplex" | "lnp" | "polyplex" | "naked"} DeliveryId
 * @typedef {"plasmid" | "mrna"} SystemId
 * @typedef {"single" | "and"} LogicId
 *
 * @typedef {object} ModelChoice
 * @property {DeliveryId} delivery
 * @property {SystemId} system
 * @property {LogicId} logic
 *
 * @typedef {object} SchemaOption
 * @property {string} id
 * @property {string} label
 * @property {string} short
 * @property {string} subtitle
 *
 * @typedef {object} InvalidCombo
 * @property {DeliveryId} [delivery]
 * @property {SystemId} [system]
 * @property {LogicId} [logic]
 * @property {string} reason
 *
 * @typedef {object} SchemaField
 * @property {string} name
 * @property {string} label
 * @property {string} unit
 * @property {number | string | boolean | number[]} default
 * @property {number} [min]
 * @property {number} [max]
 * @property {string} group
 * @property {"number" | "enum" | "boolean" | "times"} [type]
 * @property {Record<DeliveryId, number>} [byAgent]
 * @property {ModelChoice} [when]
 * @property {string} [step]
 *
 * @typedef {object} CellType
 * @property {string} id
 * @property {string} label
 * @property {string} subtitle
 * @property {"P" | "H" | "lab"} arm
 * @property {string} [disease]
 * @property {number} transfection_efficiency
 * @property {number} division_rate
 * @property {number} adar_level
 *
 * @typedef {object} WellFormat
 * @property {string} id
 * @property {string} label
 * @property {number} volume_ul
 * @property {number} typical_cells
 *
 * @typedef {object} TriggerLevels
 * @property {number} on
 * @property {number} off
 * @property {number} [onB]
 * @property {number} [offB]
 *
 * @typedef {object} TSpan
 * @property {number} t0
 * @property {number} t1
 * @property {number} n
 *
 * @typedef {object} SimulateRequest
 * @property {DeliveryId} delivery
 * @property {SystemId} system
 * @property {LogicId} logic
 * @property {Record<string, unknown>} conditions
 * @property {Record<string, number>} params
 * @property {TriggerLevels} triggerLevels
 * @property {TSpan} tSpan
 *
 * @typedef {object} Observables
 * @property {number} foldChange
 * @property {number} leak
 * @property {number} tHalf
 * @property {number} peakOutput
 *
 * @typedef {object} TruthRow
 * @property {string} inputs
 * @property {number} output
 *
 * @typedef {object} SimulateResponse
 * @property {number[]} t
 * @property {Record<string, number[]>} states
 * @property {Observables} observables
 * @property {TruthRow[]} [truthTable]
 * @property {boolean} [stub]
 */

/** @type {SchemaOption[]} */
export const DELIVERY = [
  {
    id: "lipoplex",
    label: "Lipoplex",
    short: "Lipoplex",
    subtitle: "Cationic lipid complexes",
  },
  {
    id: "lnp",
    label: "LNP",
    short: "LNP",
    subtitle: "Ionizable lipid nanoparticles",
  },
  {
    id: "polyplex",
    label: "Polyplex",
    short: "Polyplex",
    subtitle: "Cationic polymer complexes",
  },
  {
    id: "naked",
    label: "Naked",
    short: "Naked",
    subtitle: "No carrier",
  },
];

/** @type {SchemaOption[]} */
export const SYSTEM = [
  {
    id: "plasmid",
    label: "Plasmid DNA",
    short: "plasmid",
    subtitle: "Adds nuclear import and transcription",
  },
  {
    id: "mrna",
    label: "mRNA",
    short: "mRNA",
    subtitle: "Cargo is already the sensor transcript",
  },
];

/** @type {SchemaOption[]} */
export const LOGIC = [
  {
    id: "single",
    label: "Single trigger",
    short: "single trigger",
    subtitle: "One sensor, one RNA trigger",
  },
  {
    id: "and",
    label: "AND gate",
    short: "AND gate",
    subtitle: "Two sensors; output needs both",
  },
];

export const AXES = [
  { id: "delivery", label: "Delivery agent", options: DELIVERY },
  { id: "system", label: "System", options: SYSTEM },
  { id: "logic", label: "Logic", options: LOGIC },
];

/**
 * Agent × system × logic is one parameterized model.
 * These rows are greyed out (not hidden) when the other two axes would
 * make the combination invalid.
 *
 * @type {InvalidCombo[]}
 */
export const INVALID = [
  {
    delivery: "lnp",
    system: "plasmid",
    reason: "These LNP presets are for RNA cargo, not plasmid DNA.",
  },
  {
    delivery: "naked",
    system: "plasmid",
    reason: "Naked plasmid needs electroporation; this model is chemical transfection.",
  },
];

/** @type {{ id: string, label: string, delivery: DeliveryId, system: SystemId, logic: LogicId }[]} */
export const PRESETS = [
  {
    id: "lipoplex-plasmid-single",
    label: "Lipoplex-DNA-Single trigger",
    delivery: "lipoplex",
    system: "plasmid",
    logic: "single",
  },
  {
    id: "lipoplex-plasmid-and",
    label: "Lipoplex-DNA-AND-gate",
    delivery: "lipoplex",
    system: "plasmid",
    logic: "and",
  },
  {
    id: "rna-single",
    label: "Lipoplex-RNA-Single trigger",
    delivery: "lipoplex",
    system: "mrna",
    logic: "single",
  },
  {
    id: "rna-and",
    label: "Lipoplex-RNA-AND gate",
    delivery: "lipoplex",
    system: "mrna",
    logic: "and",
  },
];

export const PARAM_GROUPS = [
  { id: "delivery", label: "Delivery" },
  { id: "sensor", label: "Sensor" },
  { id: "editing", label: "Editing" },
  { id: "output", label: "Output" },
  { id: "trigger", label: "Trigger" },
];

/**
 * Kinetic parameters. `byAgent` fills Delivery-group sliders from the
 * selected agent; the user may override afterward.
 *
 * @type {SchemaField[]}
 */
export const PARAMS = [
  {
    name: "k_uptake",
    label: "Uptake",
    unit: "h⁻¹",
    default: 0.6,
    min: 0,
    max: 4,
    group: "delivery",
    byAgent: { lipoplex: 0.6, lnp: 1.0, polyplex: 0.7, naked: 0.04 },
  },
  {
    name: "k_escape",
    label: "Endosomal escape",
    unit: "h⁻¹",
    default: 0.25,
    min: 0,
    max: 3,
    group: "delivery",
    byAgent: { lipoplex: 0.25, lnp: 0.5, polyplex: 0.4, naked: 0.8 },
  },
  {
    name: "k_endo_deg",
    label: "Endosomal degradation",
    unit: "h⁻¹",
    default: 0.4,
    min: 0,
    max: 3,
    group: "delivery",
    byAgent: { lipoplex: 0.4, lnp: 0.2, polyplex: 0.35, naked: 0.1 },
  },
  {
    name: "k_tox",
    label: "Toxicity",
    unit: "h⁻¹",
    default: 0.08,
    min: 0,
    max: 0.5,
    group: "delivery",
    byAgent: { lipoplex: 0.08, lnp: 0.03, polyplex: 0.12, naked: 0.01 },
  },
  {
    name: "k_extra_deg",
    label: "Extracellular degradation",
    unit: "h⁻¹",
    default: 0.15,
    min: 0,
    max: 4,
    group: "delivery",
    byAgent: { lipoplex: 0.15, lnp: 0.05, polyplex: 0.12, naked: 1.5 },
  },
  {
    name: "k_nuclear",
    label: "Nuclear import",
    unit: "h⁻¹",
    default: 0.15,
    min: 0,
    max: 2,
    group: "delivery",
    when: { system: "plasmid" },
  },
  {
    name: "k_txn",
    label: "Transcription",
    unit: "h⁻¹",
    default: 5,
    min: 0,
    max: 20,
    group: "sensor",
    when: { system: "plasmid" },
  },
  {
    name: "k_dna_dilution",
    label: "Plasmid dilution",
    unit: "h⁻¹",
    default: 0.03,
    min: 0,
    max: 0.2,
    group: "sensor",
    when: { system: "plasmid" },
  },
  {
    name: "k_sensor_deg",
    label: "Sensor RNA turnover",
    unit: "h⁻¹",
    default: 0.2,
    min: 0.02,
    max: 2,
    group: "sensor",
  },
  {
    name: "k_translate",
    label: "Translation",
    unit: "h⁻¹",
    default: 8,
    min: 0,
    max: 40,
    group: "sensor",
  },
  {
    name: "k_edit",
    label: "ADAR editing",
    unit: "h⁻¹",
    default: 2,
    min: 0,
    max: 10,
    group: "editing",
  },
  {
    name: "K_trigger",
    label: "Trigger half-occupancy",
    unit: "TPM",
    default: 10,
    min: 0.1,
    max: 200,
    group: "editing",
  },
  {
    name: "hill_n",
    label: "Hill coefficient",
    unit: "",
    default: 2,
    min: 1,
    max: 6,
    group: "editing",
  },
  {
    name: "adar_scale",
    label: "ADAR scale",
    unit: "",
    default: 1,
    min: 0,
    max: 4,
    group: "editing",
  },
  {
    name: "leak_edit",
    label: "Off-state editing",
    unit: "",
    default: 0.02,
    min: 0,
    max: 0.3,
    group: "editing",
  },
  {
    name: "k_maturation",
    label: "Output maturation",
    unit: "h⁻¹",
    default: 0.4,
    min: 0,
    max: 2,
    group: "output",
  },
  {
    name: "k_protein_deg",
    label: "Output turnover",
    unit: "h⁻¹",
    default: 0.05,
    min: 0.005,
    max: 0.5,
    group: "output",
  },
  {
    name: "alpha_coop",
    label: "AND cooperativity",
    unit: "",
    default: 1,
    min: 0.5,
    max: 4,
    group: "output",
    when: { logic: "and" },
  },
  {
    name: "trigger_on",
    label: "Trigger ON",
    unit: "TPM",
    default: 50,
    min: 0,
    max: 500,
    group: "trigger",
  },
  {
    name: "trigger_off",
    label: "Trigger OFF",
    unit: "TPM",
    default: 5,
    min: 0,
    max: 200,
    group: "trigger",
  },
  {
    name: "trigger_on_b",
    label: "Trigger B ON",
    unit: "TPM",
    default: 40,
    min: 0,
    max: 500,
    group: "trigger",
    when: { logic: "and" },
  },
  {
    name: "trigger_off_b",
    label: "Trigger B OFF",
    unit: "TPM",
    default: 4,
    min: 0,
    max: 200,
    group: "trigger",
    when: { logic: "and" },
  },
];

/**
 * Experimental conditions. Separate from kinetic sliders.
 * Cell-type defaults (transfection efficiency, division, ADAR) live on
 * CELL_TYPES; the solver multiplies those into the run.
 *
 * @type {SchemaField[]}
 */
export const CONDITIONS = [
  {
    name: "cell_type",
    label: "Cell type",
    unit: "",
    default: "kelfib",
    group: "experiment",
    type: "enum",
  },
  {
    name: "dose",
    label: "Dose",
    unit: "ng",
    default: 100,
    min: 1,
    max: 5000,
    group: "experiment",
    type: "number",
  },
  {
    name: "dose_unit",
    label: "Dose unit",
    unit: "",
    default: "ng",
    group: "experiment",
    type: "enum",
  },
  {
    name: "well_format",
    label: "Well format",
    unit: "",
    default: "24",
    group: "experiment",
    type: "enum",
  },
  {
    name: "carrier_ratio",
    label: "Carrier ratio",
    unit: "w/w",
    default: 3,
    min: 0.5,
    max: 20,
    group: "experiment",
    type: "number",
  },
  {
    name: "seeding_cells",
    label: "Seeding density",
    unit: "cells / well",
    default: 50000,
    min: 1000,
    max: 1e6,
    group: "experiment",
    type: "number",
  },
  {
    name: "confluence",
    label: "Confluence at transfection",
    unit: "",
    default: 0.7,
    min: 0.2,
    max: 1,
    group: "experiment",
    type: "number",
    step: "0.05",
  },
  {
    name: "serum",
    label: "Serum during transfection",
    unit: "",
    default: false,
    group: "experiment",
    type: "boolean",
  },
  {
    name: "harvest_h",
    label: "Harvest timepoint",
    unit: "h",
    default: [24, 48],
    min: 1,
    max: 120,
    group: "experiment",
    type: "times",
  },
  {
    name: "co_formulation",
    label: "AND cargo mixing",
    unit: "",
    default: "together",
    group: "experiment",
    type: "enum",
    when: { logic: "and" },
  },
];

/**
 * Names reused from ranking / bulk libraries where they exist
 * (KELFIB vs HDF on keloid zips; CELLxGENE fibroblast labels).
 *
 * @type {CellType[]}
 */
export const CELL_TYPES = [
  {
    id: "kelfib",
    label: "KELFIB",
    subtitle: "Keloid fibroblasts, pathogenic arm",
    arm: "P",
    disease: "keloid",
    transfection_efficiency: 0.35,
    division_rate: 0.02,
    adar_level: 1.2,
  },
  {
    id: "hdf",
    label: "HDF",
    subtitle: "Healthy dermal fibroblasts, reference arm",
    arm: "H",
    disease: "keloid",
    transfection_efficiency: 0.4,
    division_rate: 0.022,
    adar_level: 1.0,
  },
  {
    id: "skin_fibroblast",
    label: "Skin fibroblast",
    subtitle: "CELLxGENE keloid skin fibroblast",
    arm: "P",
    disease: "keloid",
    transfection_efficiency: 0.32,
    division_rate: 0.02,
    adar_level: 1.1,
  },
  {
    id: "keloid_mfb",
    label: "Pathological MFB",
    subtitle: "Deng cluster 3 keloid myofibroblast",
    arm: "P",
    disease: "keloid",
    transfection_efficiency: 0.3,
    division_rate: 0.018,
    adar_level: 1.3,
  },
  {
    id: "primary_dermal",
    label: "Primary dermal fibroblast",
    subtitle: "Primary culture, not a cell line",
    arm: "H",
    transfection_efficiency: 0.25,
    division_rate: 0.015,
    adar_level: 1.0,
  },
  {
    id: "hek293",
    label: "HEK293",
    subtitle: "Lab transfection line",
    arm: "lab",
    transfection_efficiency: 0.7,
    division_rate: 0.035,
    adar_level: 0.8,
  },
  {
    id: "cardiac_fibroblast",
    label: "Cardiac fibroblast",
    subtitle: "Fibroblast / myofibroblast, heart",
    arm: "P",
    disease: "cardiac",
    transfection_efficiency: 0.28,
    division_rate: 0.018,
    adar_level: 1.1,
  },
  {
    id: "kidney_fibroblast",
    label: "Kidney fibroblast",
    subtitle: "Fibroblast / myofibroblast, kidney",
    arm: "P",
    disease: "kidney",
    transfection_efficiency: 0.28,
    division_rate: 0.018,
    adar_level: 1.05,
  },
  {
    id: "hepatic_stellate",
    label: "Hepatic stellate cell",
    subtitle: "Stellate / fibroblast, liver",
    arm: "P",
    disease: "liver",
    transfection_efficiency: 0.3,
    division_rate: 0.02,
    adar_level: 1.15,
  },
  {
    id: "lung_fibroblast",
    label: "Lung fibroblast",
    subtitle: "Fibroblast / myofibroblast, lung",
    arm: "P",
    disease: "pulmonary",
    transfection_efficiency: 0.3,
    division_rate: 0.02,
    adar_level: 1.1,
  },
];

/** @type {WellFormat[]} */
export const WELL_FORMATS = [
  { id: "96", label: "96-well", volume_ul: 100, typical_cells: 10000 },
  { id: "48", label: "48-well", volume_ul: 250, typical_cells: 25000 },
  { id: "24", label: "24-well", volume_ul: 500, typical_cells: 50000 },
  { id: "12", label: "12-well", volume_ul: 1000, typical_cells: 100000 },
  { id: "6", label: "6-well", volume_ul: 2000, typical_cells: 300000 },
];

export const DOSE_UNITS = [
  { id: "ng", label: "ng / well" },
  { id: "ug", label: "µg / well" },
];

export const CO_FORMULATION = [
  { id: "together", label: "Co-formulated in one particle" },
  { id: "separate", label: "Separately co-transfected" },
];

export const DEFAULT_MODEL = {
  delivery: "lipoplex",
  system: "plasmid",
  logic: "single",
};

export const DEFAULT_TSPAN = { t0: 0, t1: 72, n: 145 };

/** @param {DeliveryId} delivery */
export function carrierRatioUnit(delivery) {
  return delivery === "polyplex" ? "N:P" : "lipid:cargo";
}

/** @param {string} [diseaseId] */
export function defaultCellType(diseaseId) {
  return CELL_TYPES.find((row) => row.disease === diseaseId && row.arm === "P")?.id || "kelfib";
}

export const OPTIONS = {
  delivery: DELIVERY,
  system: SYSTEM,
  logic: LOGIC,
};

/** @param {string} axis @param {string} id */
export function optionById(axis, id) {
  return (OPTIONS[axis] || []).find((row) => row.id === id) || null;
}

/**
 * @param {DeliveryId} delivery
 * @param {SystemId} system
 * @param {LogicId} logic
 * @returns {InvalidCombo | null}
 */
export function comboBlocked(delivery, system, logic) {
  return (
    INVALID.find(
      (rule) =>
        (rule.delivery == null || rule.delivery === delivery) &&
        (rule.system == null || rule.system === system) &&
        (rule.logic == null || rule.logic === logic)
    ) || null
  );
}

/**
 * @param {"delivery" | "system" | "logic"} axis
 * @param {string} id
 * @param {ModelChoice} current
 * @returns {InvalidCombo | null}
 */
export function optionBlocked(axis, id, current) {
  const next = { ...current, [axis]: id };
  return comboBlocked(next.delivery, next.system, next.logic);
}

/** @param {ModelChoice} model */
export function summaryLine(model) {
  const delivery = optionById("delivery", model.delivery)?.short || model.delivery;
  const system = optionById("system", model.system)?.short || model.system;
  const logic = optionById("logic", model.logic)?.short || model.logic;
  return `${delivery} · ${system} · ${logic}`;
}

/** @param {ModelChoice} model */
export function matchingPreset(model) {
  return PRESETS.find(
    (row) =>
      row.delivery === model.delivery &&
      row.system === model.system &&
      row.logic === model.logic
  );
}

/** @param {SchemaField} field @param {ModelChoice} model */
export function fieldActive(field, model) {
  if (!field.when) return true;
  return Object.entries(field.when).every(([axis, id]) => model[axis] === id);
}

/** @param {DeliveryId} delivery */
export function agentParamDefaults(delivery) {
  /** @type {Record<string, number>} */
  const values = {};
  for (const field of PARAMS) {
    if (field.byAgent && field.byAgent[delivery] != null) {
      values[field.name] = field.byAgent[delivery];
    }
  }
  return values;
}

/** @param {ModelChoice} model */
export function defaultParams(model) {
  const agent = agentParamDefaults(model.delivery);
  /** @type {Record<string, number>} */
  const values = {};
  for (const field of PARAMS) {
    if (!fieldActive(field, model)) continue;
    values[field.name] = agent[field.name] ?? Number(field.default);
  }
  return values;
}

/** @param {ModelChoice} [model] */
export function defaultConditions(model = DEFAULT_MODEL) {
  /** @type {Record<string, unknown>} */
  const values = {};
  for (const field of CONDITIONS) {
    if (!fieldActive(field, model)) continue;
    values[field.name] = field.default;
  }
  const well = WELL_FORMATS.find((row) => row.id === values.well_format);
  if (well && values.seeding_cells == null) values.seeding_cells = well.typical_cells;
  return values;
}

/** @param {Record<string, unknown>} conditions */
export function cargoPerCellPg(conditions) {
  const well = WELL_FORMATS.find((row) => row.id === conditions.well_format);
  const cells = Number(conditions.seeding_cells) || well?.typical_cells || 1;
  let ng = Number(conditions.dose) || 0;
  if (conditions.dose_unit === "ug") ng *= 1000;
  return (ng * 1000) / Math.max(cells, 1);
}

/**
 * @param {ModelChoice} model
 * @param {Record<string, unknown>} [conditions]
 * @param {Record<string, number>} [params]
 * @param {TriggerLevels} [triggerLevels]
 * @param {TSpan} [tSpan]
 * @returns {SimulateRequest}
 */
export function buildRequest(
  model,
  conditions = defaultConditions(model),
  params = defaultParams(model),
  triggerLevels,
  tSpan = DEFAULT_TSPAN
) {
  const levels = triggerLevels || {
    on: params.trigger_on ?? 50,
    off: params.trigger_off ?? 5,
    ...(model.logic === "and"
      ? { onB: params.trigger_on_b ?? 40, offB: params.trigger_off_b ?? 4 }
      : {}),
  };
  return {
    delivery: model.delivery,
    system: model.system,
    logic: model.logic,
    conditions,
    params,
    triggerLevels: levels,
    tSpan,
  };
}
