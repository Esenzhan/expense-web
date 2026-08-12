// Category registry — one independent list per wallet. Starts with the
// built-in set on every wallet (mirrors the backend seed) and is replaced
// by the server's per-wallet lists once they load.
const DEFAULT_LIST = [
  { name: "Кафе и рестораны", emoji: "🍴", bg: "#fde2e1", fg: "#c23b3b" },
  { name: "Продукты", emoji: "🛒", bg: "#e1f3e3", fg: "#2f8f4e" },
  { name: "Такси", emoji: "🚕", bg: "#fff2cf", fg: "#a9790a" },
  { name: "Транспорт", emoji: "🚌", bg: "#e3ecfd", fg: "#2f5fc2" },
  { name: "Связь и интернет", emoji: "📱", bg: "#eee3fd", fg: "#7440c2" },
  { name: "Развлечения", emoji: "🎮", bg: "#ffe6d1", fg: "#c2681f" },
  { name: "Здоровье", emoji: "💊", bg: "#d8f5f1", fg: "#1f9e8c" },
  { name: "Одежда", emoji: "👕", bg: "#fde1ef", fg: "#c23b8f" },
  { name: "Жильё", emoji: "🏠", bg: "#ece3d8", fg: "#8a6a3f" },
  { name: "Прочее", emoji: "💳", bg: "#e9e9ec", fg: "#5b5b63" },
];
const DEFAULT_WALLETS = ["Личные", "Семья", "Бизнес", "Ремонт"];

const FALLBACK = { emoji: "💳", bg: "#e9e9ec", fg: "#5b5b63" };

let categories = Object.fromEntries(DEFAULT_WALLETS.map((w) => [w, DEFAULT_LIST]));

// Accepts the flat, wallet-tagged list the API returns (GET /api/categories
// with no ?wallet= filter — every row has a `wallet` field) and groups it.
export function hydrateCategories(list) {
  if (!Array.isArray(list) || !list.length || !list.every((c) => c.name && c.emoji && c.wallet)) {
    return;
  }
  const grouped = {};
  for (const cat of list) {
    (grouped[cat.wallet] ??= []).push(cat);
  }
  categories = grouped;
}

export function listCategories(wallet) {
  return categories[wallet] || [];
}

export function getCategoryIcon(wallet, name) {
  return listCategories(wallet).find((c) => c.name === name) || FALLBACK;
}
