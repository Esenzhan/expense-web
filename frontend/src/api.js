import { getToken, clearToken } from "./auth";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/voice";
export const GOOGLE_LOGIN_URL = `${API_BASE}/api/auth/google/start`;

// Central fetch wrapper — every authenticated call goes through this so the
// Bearer token only has to be wired up in one place. A 401 means the
// session's dead (expired/rejected token); broadcast it so App.jsx can drop
// back to the login screen instead of quietly failing every request.
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("traty:unauthorized"));
  }
  return res;
}

export async function fetchMe() {
  const res = await apiFetch("/api/auth/me");
  if (!res.ok) throw new Error("Не авторизован");
  return res.json();
}

export async function fetchExpenses(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await apiFetch(`/api/expenses${qs ? `?${qs}` : ""}`);
  return res.json();
}

// All expenses in a date range, for computing Insights client-side (see
// insights.js) — a generous limit since this covers a whole period at once,
// not just the most recent handful shown in the list.
export async function fetchExpensesRange(from, to, wallet) {
  const params = { from: from.toISOString(), to: to.toISOString(), limit: 2000 };
  if (wallet) params.wallet = wallet;
  return fetchExpenses(params);
}

// Safari: "Load failed", Chrome: "Failed to fetch", Firefox: "NetworkError
// when attempting to fetch resource." — fetch throws a plain TypeError with
// no `.code`, so matching the message is the only reliable signal.
export function isNetworkError(err) {
  return err instanceof TypeError || /load failed|failed to fetch|networkerror/i.test(err?.message || "");
}

export async function createExpense(payload) {
  const res = await apiFetch(`/api/expenses`, {
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
  const res = await apiFetch(`/api/expenses/${id}`, {
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
  await apiFetch(`/api/expenses/${id}`, { method: "DELETE" });
}

export async function fetchWalletTotals() {
  const res = await apiFetch(`/api/stats/by-wallet`);
  return res.json();
}

export async function fetchSummary(period = "month", wallet) {
  const qs = new URLSearchParams({ period });
  if (wallet) qs.set("wallet", wallet);
  const res = await apiFetch(`/api/stats/summary?${qs}`);
  return res.json();
}

export async function fetchWallets() {
  const res = await apiFetch(`/api/wallets`);
  return res.json();
}

export async function createWallet(payload) {
  const res = await apiFetch(`/api/wallets`, {
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
  const res = await apiFetch(`/api/wallets/${encodeURIComponent(oldName)}`, {
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
  const res = await apiFetch(`/api/categories`);
  return res.json();
}

export async function createCategory(payload) {
  const res = await apiFetch(`/api/categories`, {
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
