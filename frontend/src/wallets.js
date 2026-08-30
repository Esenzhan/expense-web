// Wallet registry — mirrors the backend seed until the server list (with
// user-created wallets) hydrates it.
const DEFAULTS = [
  { name: "Личные", emoji: "👛", bg: "#d7f5e9", fg: "#159969", shared: false },
  { name: "Семья", emoji: "👨‍👩‍👧", bg: "#e3ecfd", fg: "#2f5fc2", shared: true },
  { name: "Бизнес", emoji: "💼", bg: "#fde2e1", fg: "#c23b3b", shared: true },
  { name: "Ремонт", emoji: "🔨", bg: "#fff2cf", fg: "#a9790a", shared: true },
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

// Общий (visible to and pooled across both accounts) vs личный (scoped to
// whoever logged it) — the server decides this per wallet, so nothing here
// may assume it from the name. Unknown wallets read as shared, matching the
// server's own default for anything created without the flag.
export function isSharedWallet(name) {
  const wallet = wallets.find((w) => w.name === name);
  return wallet ? wallet.shared !== false : true;
}

