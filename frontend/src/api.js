import { staticCsv, staticOverview, staticSearch, staticSite, staticSuggest } from "./candidatesStatic.js";
import { staticExpression } from "./gtexStatic.js";
import { simulateLocal } from "./playground/simulate.js";
import { foldSensor } from "./rna/foldSensor.js";

async function jsonIfReady(response) {
  const type = response.headers.get("content-type") || "";
  if (!response.ok || !type.includes("json")) return null;
  return response.json();
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(
      typeof detail === "string" ? detail : detail?.[0]?.msg || response.statusText
    );
  }
  return data;
}

export const api = {
  suggest: async (q) => {
    try {
      const data = await jsonIfReady(await fetch(`/api/suggest?q=${encodeURIComponent(q || "")}`));
      if (data && Array.isArray(data.genes)) return data;
    } catch {
      // Hosted site uses the static gene catalog.
    }
    return { genes: await staticSuggest(q) };
  },
  overview: async (gene) => {
    try {
      const data = await jsonIfReady(
        await fetch(`/api/gene/${encodeURIComponent(gene)}/overview`)
      );
      if (data?.filters?.region_types) return data;
    } catch {
      // Hosted site uses the static candidate tables.
    }
    return staticOverview(gene);
  },
  search: async (body) => {
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await jsonIfReady(response);
      if (data && Array.isArray(data.rows)) return data;
    } catch {
      // Hosted site filters the static candidate table in the browser.
    }
    return staticSearch(body);
  },
  site: async (gene, matches) => {
    try {
      const data = await jsonIfReady(
        await fetch(
          `/api/gene/${encodeURIComponent(gene)}/site?matches=${encodeURIComponent(matches || "")}`
        )
      );
      if (data && Array.isArray(data.isoforms)) return data;
    } catch {
      // Hosted site reads isoform presence from the static table.
    }
    return staticSite(gene, matches);
  },
  expression: async (gene, tissue) => {
    const path = `/api/gene/${encodeURIComponent(gene)}/expression${
      tissue ? `?tissue=${encodeURIComponent(tissue)}` : ""
    }`;
    try {
      const response = await fetch(path, { headers: { Accept: "application/json" } });
      const type = response.headers.get("content-type") || "";
      if (response.ok && type.includes("application/json")) return response.json();
    } catch {
      // The hosted site has no folding API, so isoform TPM comes from the static table.
    }
    return staticExpression(gene, tissue);
  },
  fasta: (gene) => request(`/api/fasta/${encodeURIComponent(gene)}`),
  accessibility: (body) =>
    request("/api/accessibility", { method: "POST", body: JSON.stringify(body) }),
  fragment: (body) =>
    request("/api/accessibility/fragment", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  sensor: async (sequence) => {
    try {
      const response = await fetch("/api/sensor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence }),
      });
      const data = await jsonIfReady(response);
      if (data?.mfe_structure && Array.isArray(data.pairing_probability)) return data;
    } catch {
      // The hosted site has no ViennaRNA process, so the fold runs in the browser.
    }
    return foldSensor(sequence);
  },
  simulate: async (body) => {
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await jsonIfReady(response);
      if (data?.t && data?.states) return data;
    } catch {
      // The hosted site runs the same placeholder curves in the browser.
    }
    return simulateLocal(body);
  },
  bulkZip: async (file) => {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/bulk-zip", { method: "POST", body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.detail;
      throw new Error(
        typeof detail === "string" ? detail : detail?.[0]?.msg || response.statusText
      );
    }
    return data;
  },
  exportCsv: async (body) => {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const type = response.headers.get("content-type") || "";
    let csvText = "";
    if (response.ok && type.includes("text/csv")) {
      csvText = await response.text();
    } else {
      const data = await staticSearch({ ...body, page: 1, page_size: 100000 });
      csvText = staticCsv(data.rows);
    }
    const blob = new Blob([csvText], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(body.gene || "radar").toUpperCase()}_radar_candidates.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },
};
