const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/voice";

export async function fetchExpenses(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/api/expenses${qs ? `?${qs}` : ""}`);
  return res.json();
}

// Safari: "Load failed", Chrome: "Failed to fetch", Firefox: "NetworkError
// when attempting to fetch resource." — fetch throws a plain TypeError with
// no `.code`, so matching the message is the only reliable signal.
export function isNetworkError(err) {
  return err instanceof TypeError || /load failed|failed to fetch|networkerror/i.test(err?.message || "");
}

export async function createExpense(payload) {
  const res = await fetch(`${API_BASE}/api/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить трату");
  }
  return res.json();
}

export async function updateExpense(id, payload) {
  const res = await fetch(`${API_BASE}/api/expenses/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось обновить трату");
  }
  return res.json();
}

export async function deleteExpense(id) {
  await fetch(`${API_BASE}/api/expenses/${id}`, { method: "DELETE" });
}

export async function fetchWalletTotals() {
  const res = await fetch(`${API_BASE}/api/stats/by-wallet`);
  return res.json();
}

export async function fetchSummary(period = "month", wallet) {
  const qs = new URLSearchParams({ period });
  if (wallet) qs.set("wallet", wallet);
  const res = await fetch(`${API_BASE}/api/stats/summary?${qs}`);
  return res.json();
}

export async function fetchInsights(period = "month", wallet) {
  const qs = new URLSearchParams({ period });
  if (wallet) qs.set("wallet", wallet);
  const res = await fetch(`${API_BASE}/api/stats/insights?${qs}`);
  return res.json();
}

export async function fetchWallets() {
  const res = await fetch(`${API_BASE}/api/wallets`);
  return res.json();
}

export async function createWallet(payload) {
  const res = await fetch(`${API_BASE}/api/wallets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось создать счёт");
  }
  return res.json();
}

export async function updateWallet(oldName, payload) {
  const res = await fetch(`${API_BASE}/api/wallets/${encodeURIComponent(oldName)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось обновить счёт");
  }
  return res.json();
}

export async function fetchCategories() {
  const res = await fetch(`${API_BASE}/api/categories`);
  return res.json();
}

export async function createCategory(payload) {
  const res = await fetch(`${API_BASE}/api/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось создать категорию");
  }
  return res.json();
}

// Fire-and-forget ping so Render's free tier starts waking up as soon as the
// app opens, instead of on the first voice-recording attempt
export function warmBackend() {
  fetch(`${API_BASE}/api/health`).catch(() => {});
}
