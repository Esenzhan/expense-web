const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/voice";

export async function fetchExpenses(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/api/expenses${qs ? `?${qs}` : ""}`);
  return res.json();
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

export async function fetchSummary(period = "month") {
  const res = await fetch(`${API_BASE}/api/stats/summary?period=${period}`);
  return res.json();
}

export async function fetchInsights(period = "month") {
  const res = await fetch(`${API_BASE}/api/stats/insights?period=${period}`);
  return res.json();
}
