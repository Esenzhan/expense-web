const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/voice";

export async function fetchExpenses(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/api/expenses${qs ? `?${qs}` : ""}`);
  return res.json();
}

export async function deleteExpense(id) {
  await fetch(`${API_BASE}/api/expenses/${id}`, { method: "DELETE" });
}

export async function fetchWalletTotals() {
  const res = await fetch(`${API_BASE}/api/stats/by-wallet`);
  return res.json();
}

export async function fetchCategoryTotals(days = 30) {
  const res = await fetch(`${API_BASE}/api/stats/by-category?days=${days}`);
  return res.json();
}

export async function fetchDailyTotals(days = 30) {
  const res = await fetch(`${API_BASE}/api/stats/daily?days=${days}`);
  return res.json();
}
