// Shared color palette + icon picker groups for NewCategorySheet and
// NewWalletSheet — one list for both (categories and wallets used to each
// have their own separate, narrower set; unified on request so a color or
// icon available in one picker is available in the other too).

// bg = pastel tile, fg = strong accent (shown in the palette swatch). Dark
// mode inverts these (see .category-icon in styles.css) — --cat-fg becomes
// the solid fill — so fg needs to stay a mid-tone, reasonably saturated
// color like the rest of the set, not too light or too dark.
export const PALETTE = [
  { bg: "#e9e9ec", fg: "#3a3a40" }, // neutral
  { bg: "#fde2e1", fg: "#c23b3b" }, // red
  { bg: "#ffe6d1", fg: "#c2681f" }, // orange
  { bg: "#fff2cf", fg: "#a9790a" }, // gold
  { bg: "#ecf7d4", fg: "#5f8f1f" }, // lime
  { bg: "#e1f3e3", fg: "#2f8f4e" }, // green
  { bg: "#d8f5f1", fg: "#1f9e8c" }, // teal
  { bg: "#dff0fb", fg: "#1f7fae" }, // sky
  { bg: "#e3ecfd", fg: "#2f5fc2" }, // blue
  { bg: "#eee3fd", fg: "#7440c2" }, // purple
  { bg: "#fde1ef", fg: "#c23b8f" }, // pink
  { bg: "#ece3d8", fg: "#8a6a3f" }, // brown
  { bg: "#f6ddd2", fg: "#a8461f" }, // rust
  { bg: "#f0eeca", fg: "#7d7d1f" }, // olive
  { bg: "#e3e4fb", fg: "#4c4fc9" }, // indigo
  { bg: "#f5e0f7", fg: "#a83bc2" }, // orchid
  { bg: "#ffe0e6", fg: "#d13a5c" }, // rose
  { bg: "#e6e9ee", fg: "#52606d" }, // slate
  { bg: "#d6f4f7", fg: "#1590a8" }, // cyan
  { bg: "#f3dde3", fg: "#8a2a4a" }, // plum
];

export const ICON_GROUPS = [
  { title: "Покупки", icons: ["🛍️", "👜", "🧥", "👕", "👟", "⌚", "👗", "🧢", "🧦", "👠", "🕶️", "💄", "💎"] },
  { title: "Еда", icons: ["🍴", "☕", "🍕", "🍔", "🥗", "🍱", "🍜", "🧁", "🍩", "🍺", "🥡", "🍎", "🎂"] },
  { title: "Транспорт", icons: ["🚕", "🚌", "🚗", "⛽", "🚲", "✈️", "🚇", "🛴", "🚄", "⛴️"] },
  { title: "Дом и быт", icons: ["🏠", "🛋️", "🛏️", "🚪", "🧹", "🧺", "🔧", "💡", "🪴", "🧴", "🔨"] },
  {
    title: "Развлечения и хобби",
    icons: ["🎮", "🎬", "🎵", "🎢", "🎳", "🎨", "📚", "🎟️", "🎤", "⚽", "🎸", "🎧", "📷", "🎲", "🏆", "📺"],
  },
  { title: "Здоровье", icons: ["💊", "🏥", "🦷", "🏋️", "🧘", "💆", "🩺", "🧖", "💉", "👓"] },
  { title: "Семья и питомцы", icons: ["👨‍👩‍👧", "👶", "🐶", "🐱", "🐟", "🐦", "🐾", "👥", "❤️"] },
  { title: "Путешествия и природа", icons: ["🏖️", "⛑️", "🌱", "🌿", "🌲", "🌸", "⛰️", "⛺", "🌊", "☂️"] },
  { title: "Финансы", icons: ["👛", "💰", "🏦", "💵", "🐷", "🪙", "📈", "📉", "🧾", "🧮", "💳"] },
  { title: "Работа и учёба", icons: ["💼", "🤝", "🏢", "🧑‍💻", "🛠️", "📊", "🎓", "💻", "✏️", "📅", "🕐"] },
  { title: "Праздники и подарки", icons: ["🎁", "🎉", "✨", "🎄", "💍"] },
  { title: "Прочее", icons: ["📱", "✂️", "💧", "📦", "🔄", "⚡", "⭐"] },
];
