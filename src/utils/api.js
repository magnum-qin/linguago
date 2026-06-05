export async function fetchRemoteSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error("settings unavailable");
  return response.json();
}

export async function fetchRemoteModels() {
  const response = await fetch("/api/models", { cache: "no-store" });
  if (!response.ok) throw new Error("models unavailable");
  return response.json();
}

export async function saveRemoteSettings(settings) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "error");
  return data;
}

export async function verifyTranslation(payload) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "error");
  return data;
}

export async function reportTranslationError(payload) {
  const response = await fetch("/api/report-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "error");
  return data;
}

export async function fetchDictionaryStats() {
  const response = await fetch("/api/dictionary/stats");
  if (!response.ok) throw new Error("dictionary unavailable");
  return response.json();
}

export function openTranslationStream(payload) {
  return fetch("/api/translate-stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}
