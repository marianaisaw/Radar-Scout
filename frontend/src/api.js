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
  suggest: (q) => request(`/api/suggest?q=${encodeURIComponent(q || "")}`),
  overview: (gene) => request(`/api/gene/${encodeURIComponent(gene)}/overview`),
  search: (body) =>
    request("/api/search", { method: "POST", body: JSON.stringify(body) }),
  site: (gene, matches) =>
    request(
      `/api/gene/${encodeURIComponent(gene)}/site?matches=${encodeURIComponent(matches || "")}`
    ),
  expression: (gene, tissue) =>
    request(
      `/api/gene/${encodeURIComponent(gene)}/expression${
        tissue ? `?tissue=${encodeURIComponent(tissue)}` : ""
      }`
    ),
  fasta: (gene) => request(`/api/fasta/${encodeURIComponent(gene)}`),
  accessibility: (body) =>
    request("/api/accessibility", { method: "POST", body: JSON.stringify(body) }),
  fragment: (body) =>
    request("/api/accessibility/fragment", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  sensor: (sequence) =>
    request("/api/sensor", { method: "POST", body: JSON.stringify({ sequence }) }),
  simulate: (body) =>
    request("/api/simulate", { method: "POST", body: JSON.stringify(body) }),
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
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || response.statusText);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(body.gene || "radar").toUpperCase()}_radar_candidates.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },
};
