import { pool } from "./db.js";

// Wallets live in the DB (user-creatable). Cached briefly for the hot paths
// (expense validation, voice parsing, visibility filtering).
let cachedWallets = null; // [{ name, shared }]
let cachedAt = 0;

async function allWallets() {
  if (cachedWallets && Date.now() - cachedAt < 60000) return cachedWallets;
  const { rows } = await pool.query(`SELECT name, shared FROM wallets ORDER BY sort_order, id`);
  cachedWallets = rows;
  cachedAt = Date.now();
  return cachedWallets;
}

export function invalidateWalletCache() {
  cachedWallets = null;
}

export async function walletNames() {
  return (await allWallets()).map((w) => w.name);
}

// Shared wallets (Семья/Бизнес/Ремонт by default) are visible to and
// editable by both accounts, unlike private ones (Личные) which stay
// scoped to whoever logged them.
export async function sharedWalletNames() {
  return (await allWallets()).filter((w) => w.shared).map((w) => w.name);
}

export async function isValidWallet(wallet) {
  return (await walletNames()).includes(wallet);
}

export async function fallbackWallet() {
  const names = await walletNames();
  return names.includes("Личные") ? "Личные" : names[0];
}
