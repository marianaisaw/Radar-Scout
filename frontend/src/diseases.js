export const FIBROSIS = [
  {
    id: "cardiac",
    label: "Cardiac fibrosis",
    short: "Heart",
    key: "cardiac_fibrosis_pooled",
    blurb: "Fibroblasts in fibrotic heart tissue",
    gtexTissue: "Heart - Left Ventricle",
    organ: "/organs/cardiac.png",
  },
  {
    id: "keloid",
    label: "Keloid",
    short: "Skin",
    key: "keloid_pooled",
    blurb: "Pathogenic dermal / mesenchymal fibroblasts",
    gtexTissue: "Cells - Cultured fibroblasts",
    organ: "/kele.png",
  },
  {
    id: "kidney",
    label: "Kidney fibrosis",
    short: "Kidney",
    key: "kidney_fibrosis_pooled",
    blurb: "Fibroblasts in fibrotic kidney tissue",
    gtexTissue: "Cells - Cultured fibroblasts",
    gtexNote: "GTEx has no kidney long-read samples, so isoform abundance uses cultured fibroblasts.",
    organ: "/organs/kidney.png",
  },
  {
    id: "liver",
    label: "Liver fibrosis",
    short: "Liver",
    key: "liver_fibrosis_pooled",
    blurb: "Stellate / fibroblast states in fibrotic liver",
    gtexTissue: "Liver",
    organ: "/organs/liver.png",
  },
  {
    id: "pulmonary",
    label: "Pulmonary fibrosis",
    short: "Lung",
    key: "pulmonary_fibrosis_pooled",
    blurb: "Fibroblasts in fibrotic lung tissue",
    gtexTissue: "Lung",
    organ: "/organs/pulmonary.png",
  },
];

export function fibrosisById(id) {
  const needle = String(id || "").toLowerCase();
  return (
    FIBROSIS.find((item) => item.id === id) ||
    FIBROSIS.find((item) => needle.includes(item.id)) ||
    FIBROSIS[1]
  );
}

export function organSrc(id) {
  return fibrosisById(id).organ || "/kele.png";
}
