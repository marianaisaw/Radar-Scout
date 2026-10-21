export const SAVED_KEY = "radar-saved-candidates";

export function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
  } catch {
    return [];
  }
}

export function storeSaved(rows) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(rows));
}
