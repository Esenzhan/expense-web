// Wallet registry — mirrors the backend seed until the server list (with
// user-created wallets) hydrates it.
import { HOME_CURRENCY } from "./currencies";

const DEFAULTS = [
  { name: "Личные", emoji: "👛", bg: "#d7f5e9", fg: "#159969", scope: "personal", currency: "KZT" },
  { name: "Семья", emoji: "👨‍👩‍👧", bg: "#e3ecfd", fg: "#2f5fc2", scope: "shared", currency: "KZT" },
  { name: "Бизнес", emoji: "💼", bg: "#fde2e1", fg: "#c23b3b", scope: "shared", currency: "KZT" },
  { name: "Ремонт", emoji: "🔨", bg: "#fff2cf", fg: "#a9790a", scope: "shared", currency: "KZT" },
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

// Три группы счетов, порядок как в списке: сначала личные, потом общие,
// потом «Другое». Сервер решает группу за нас (wallets.scope), из названия
// счёта ничего не выводим.
export const SCOPE_ORDER = ["personal", "shared", "other"];

// `shared` — алиас для старого закэшированного ответа, который ещё не знает
// про группы: там true значило «общий», false — «личный».
function scopeOf(wallet) {
  if (!wallet) return "shared";
  return wallet.scope || (wallet.shared === false ? "personal" : "shared");
}

export function walletScope(name) {
  return scopeOf(wallets.find((w) => w.name === name));
}

// «Общий» — траты видны обоим аккаунтам и идут в общие итоги. Всё
// остальное (личные и «Другое») у каждого аккаунта своё.
export function isSharedWallet(name) {
  return walletScope(name) === "shared";
}

// Входит ли счёт в общий итог «Все счета». Два условия, и оба важны:
// валюта должна быть домашней (юани с тенге не складываются), а группа —
// не «Другое»: это отдельный карман, его смотрят, выбрав его в списке, и в
// общий итог он не идёт. Единственное место, где это решается — иначе
// «Все счета», «Баланс», «Расходы» и список трат разъедутся между собой.
export function isInAllAccounts(name) {
  return isHomeWallet(name) && walletScope(name) !== "other";
}

// Счета, разложенные по группам в порядке SCOPE_ORDER; внутри группы —
// порядок, пришедший с сервера. Пустые группы не возвращаются, чтобы
// список не показывал заголовок без единого счёта под ним.
export function walletsByScope() {
  return SCOPE_ORDER.map((scope) => ({
    scope,
    items: wallets.filter((w) => scopeOf(w) === scope),
  })).filter((group) => group.items.length > 0);
}

