// Wallet registry — mirrors the backend seed until the server list (with
// user-created wallets) hydrates it.
const DEFAULTS = [
  { name: "Личные", emoji: "👛", bg: "#d7f5e9", fg: "#159969" },
  { name: "Семья", emoji: "👨‍👩‍👧", bg: "#e3ecfd", fg: "#2f5fc2" },
  { name: "Бизнес", emoji: "💼", bg: "#fde2e1", fg: "#c23b3b" },
  { name: "Ремонт", emoji: "🔨", bg: "#fff2cf", fg: "#a9790a" },
];

const FALLBACK = { emoji: "👛", bg: "#e9e9ec", fg: "#5b5b63" };

let wallets = DEFAULTS;

export function hydrateWallets(list) {
  if (Array.isArray(list) && list.length && list.every((w) => w.name && w.emoji)) {
    wallets = list;
  }
}

export function listWallets() {
  return wallets;
}

export function getWalletIcon(name) {
  return wallets.find((w) => w.name === name) || FALLBACK;
}

