// Wallet registry — mirrors the backend seed until the server list (with
// user-created wallets) hydrates it.
import { HOME_CURRENCY } from "./currencies";

const DEFAULTS = [
  { name: "Личные", emoji: "👛", bg: "#d7f5e9", fg: "#159969", shared: false, currency: "KZT" },
  { name: "Семья", emoji: "👨‍👩‍👧", bg: "#e3ecfd", fg: "#2f5fc2", shared: true, currency: "KZT" },
  { name: "Бизнес", emoji: "💼", bg: "#fde2e1", fg: "#c23b3b", shared: true, currency: "KZT" },
  { name: "Ремонт", emoji: "🔨", bg: "#fff2cf", fg: "#a9790a", shared: true, currency: "KZT" },
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
// Валюта счёта. Неизвестный счёт читается как тенговый — это и поведение
// по умолчанию на сервере, и безопасная сторона ошибки: тенговую сумму
// хотя бы не покажет юанями.
export function walletCurrency(name) {
  return wallets.find((w) => w.name === name)?.currency || HOME_CURRENCY;
}

// Валютные кошельки нельзя складывать с тенговыми (см. currencies.js).
// Везде, где считается итог «по всем счетам», фильтруем через это.
export function isHomeWallet(name) {
  return walletCurrency(name) === HOME_CURRENCY;
}

export function isSharedWallet(name) {
  const wallet = wallets.find((w) => w.name === name);
  return wallet ? wallet.shared !== false : true;
}

