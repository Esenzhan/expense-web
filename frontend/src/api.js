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
// not just the most recent handful shown in the list. type=expense always:
// "Расходы"/Insights are a spend figure, income must never inflate or
// dilute it (see App.jsx's mergeAndSet for where income gets its own,
// separate accounting instead).
export async function fetchExpensesRange(from, to, wallet) {
  const params = { from: from.toISOString(), to: to.toISOString(), limit: 2000, type: "expense" };
  if (wallet) params.wallet = wallet;
  return fetchExpenses(params);
}

// Free-text search over description/category/amount — not period-bounded,
// searches the account's whole history (within the usual shared-wallet
// visibility rules).
export async function searchExpenses(query, wallet) {
  const params = { q: query, limit: 200 };
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
    const err = new Error(body.error || "Не удалось сохранить трату");
    // Код ответа нужен офлайн-очереди: по нему она отличает «сервер занят,
    // попробуй позже» от «эта запись не пройдёт никогда» — см.
    // isPermanentRejection в offlineQueue.js.
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// imageDataUrl: a data: URL (e.g. from canvas.toDataURL), not a raw file —
// the caller resizes/compresses client-side before this ever hits the wire.
export async function scanReceipt(imageDataUrl) {
  const res = await apiFetch(`/api/expenses/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Не удалось распознать чек");
  }
  return body.proposal;
}

// Same photo, but for a receipt with several line items ("Раздельно" in the
// scan camera) — each item comes back as its own expense proposal instead
// of one combined total.
export async function scanReceiptItems(imageDataUrl) {
  const res = await apiFetch(`/api/expenses/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageDataUrl, mode: "split" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "Не удалось распознать чек");
  }
  return body.proposals;
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

export async function fetchSheetsSyncStatus() {
  const res = await apiFetch(`/api/expenses/sheets-sync-status`);
  return res.json();
}

export async function fetchWalletTotals() {
  const res = await apiFetch(`/api/stats/by-wallet`);
  return res.json();
}

export async function fetchWalletBalances() {
  const res = await apiFetch(`/api/wallet-balances`);
  return res.json();
}

export async function setWalletBalance(wallet, amount) {
  const res = await apiFetch(`/api/wallet-balances/${encodeURIComponent(wallet)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить баланс");
  }
  return res.json();
}

export async function fetchBalanceHistory(wallet) {
  const params = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
  const res = await apiFetch(`/api/balance-history${params}`);
  return res.json();
}

export async function transferBetweenWallets(from, to, amount) {
  const res = await apiFetch(`/api/wallet-transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, amount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось выполнить перевод");
  }
  return res.json();
}

export async function fetchWallets() {
  const res = await apiFetch(`/api/wallets`);
  return res.json();
}

export async function fetchDebts() {
  const res = await apiFetch(`/api/debts`);
  return res.json();
}

export async function fetchDebtPayments(debtId) {
  const res = await apiFetch(`/api/debts/${debtId}/payments`);
  return res.json();
}

export async function createDebt(payload) {
  const res = await apiFetch(`/api/debts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить долг");
  }
  return res.json();
}

export async function payDebt(debtId, amount) {
  const res = await apiFetch(`/api/debts/${debtId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить платёж");
  }
  return res.json();
}

export async function deleteDebt(debtId) {
  const res = await apiFetch(`/api/debts/${debtId}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось удалить долг");
  }
}

export async function fetchCapitalSnapshots() {
  const res = await apiFetch(`/api/capital`);
  return res.json();
}

export async function fetchCapitalSnapshot(id) {
  const res = await apiFetch(`/api/capital/${id}`);
  return res.json();
}

// createdAt: an ISO string from DateTimePickerSheet, or null to let the
// snapshot land on "now" — same shape as an expense's created_at override.
export async function createCapitalSnapshot(items, createdAt, rates) {
  const res = await apiFetch(`/api/capital`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, ...(createdAt ? { createdAt } : {}), rates: rates || {} }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить снимок капитала");
  }
  return res.json();
}

export async function updateCapitalSnapshot(id, items, createdAt, rates) {
  const res = await apiFetch(`/api/capital/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, ...(createdAt ? { createdAt } : {}), rates: rates || {} }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить изменения");
  }
  return res.json();
}

export async function deleteCapitalSnapshot(id) {
  const res = await apiFetch(`/api/capital/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось удалить снимок");
  }
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

// Полный список имён в новом порядке — целиком, а не «откуда/куда»: так
// клиент со устаревшим списком не вплетёт своё представление в чужое.
export async function reorderWallets(names) {
  const res = await apiFetch(`/api/wallets/order`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить порядок счетов");
  }
}

export async function deleteWallet(name) {
  const res = await apiFetch(`/api/wallets/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось удалить счёт");
  }
}

// No args: every wallet's expense categories (the default, matches every
// existing caller). Pass { type: "income" } for the income picker's list —
// { wallet } to scope to one wallet either way.
export async function fetchCategories(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await apiFetch(`/api/categories${qs ? `?${qs}` : ""}`);
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

export async function updateCategory(wallet, name, payload) {
  const res = await apiFetch(
    `/api/categories/${encodeURIComponent(wallet)}/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось обновить категорию");
  }
  return res.json();
}

// New order for one wallet's category list — the full list of names as the
// user arranged them by dragging (see CategoriesSheet's drag handle).
export async function reorderCategories(wallet, names) {
  const res = await apiFetch(`/api/categories/order`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, names }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить порядок");
  }
}

export async function deleteCategory(wallet, name) {
  const res = await apiFetch(
    `/api/categories/${encodeURIComponent(wallet)}/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось удалить категорию");
  }
}

export async function fetchCategoryLimits(wallet) {
  const res = await apiFetch(`/api/category-limits?wallet=${encodeURIComponent(wallet)}`);
  return res.json();
}

export async function setCategoryLimit(wallet, category, monthlyLimit) {
  const res = await apiFetch(
    `/api/category-limits/${encodeURIComponent(wallet)}/${encodeURIComponent(category)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_limit: monthlyLimit }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить лимит");
  }
  return res.json();
}

export async function deleteCategoryLimit(wallet, category) {
  const res = await apiFetch(
    `/api/category-limits/${encodeURIComponent(wallet)}/${encodeURIComponent(category)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Не удалось удалить лимит");
}

export async function fetchReminderSettings() {
  const res = await apiFetch(`/api/reminders`);
  return res.json();
}

export async function saveReminderSettings(payload) {
  const res = await apiFetch(`/api/reminders`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить напоминание");
  }
  return res.json();
}

export async function saveThemeSetting(theme) {
  const res = await apiFetch(`/api/auth/theme`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось сохранить тему");
  }
  return res.json();
}

export async function subscribeReminderPush(subscription) {
  const res = await apiFetch(`/api/reminders/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Не удалось подписаться на уведомления");
  }
}

export async function unsubscribeReminderPush(endpoint) {
  await apiFetch(`/api/reminders/subscribe`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

// Fire-and-forget ping so Render's free tier starts waking up as soon as the
// app opens, instead of on the first voice-recording attempt
export function warmBackend() {
  fetch(`${API_BASE}/api/health`).catch(() => {});
}
