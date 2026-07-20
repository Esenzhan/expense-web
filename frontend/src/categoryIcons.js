// Category registry. Starts with the built-in set (mirrors the backend seed)
// and is replaced by the server's list — which includes user-created
// categories — once it loads.
const DEFAULTS = [
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

const FALLBACK = { emoji: "💳", bg: "#e9e9ec", fg: "#5b5b63" };

let categories = DEFAULTS;

export function hydrateCategories(list) {
  if (Array.isArray(list) && list.length && list.every((c) => c.name && c.emoji)) {
    categories = list;
  }
}

export function listCategories() {
  return categories;
}

export function getCategoryIcon(name) {
  return categories.find((c) => c.name === name) || FALLBACK;
}
