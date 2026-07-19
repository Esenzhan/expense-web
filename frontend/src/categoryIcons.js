// Must mirror backend/src/categories.js
const ICONS = {
  "Кафе и рестораны": { emoji: "🍴", bg: "#fde2e1", fg: "#c23b3b" },
  "Продукты": { emoji: "🛒", bg: "#e1f3e3", fg: "#2f8f4e" },
  "Такси": { emoji: "🚕", bg: "#fff2cf", fg: "#a9790a" },
  "Транспорт": { emoji: "🚌", bg: "#e3ecfd", fg: "#2f5fc2" },
  "Связь и интернет": { emoji: "📱", bg: "#eee3fd", fg: "#7440c2" },
  "Развлечения": { emoji: "🎮", bg: "#ffe6d1", fg: "#c2681f" },
  "Здоровье": { emoji: "💊", bg: "#d8f5f1", fg: "#1f9e8c" },
  "Одежда": { emoji: "👕", bg: "#fde1ef", fg: "#c23b8f" },
  "Жильё": { emoji: "🏠", bg: "#ece3d8", fg: "#8a6a3f" },
  "Прочее": { emoji: "💳", bg: "#e9e9ec", fg: "#5b5b63" },
};

export function getCategoryIcon(category) {
  return ICONS[category] || ICONS["Прочее"];
}
