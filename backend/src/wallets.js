import { pool } from "./db.js";

// Wallets live in the DB (user-creatable). Names are cached briefly for the
// hot paths (expense validation, voice parsing).
let cachedNames = null;
let cachedAt = 0;

export async function walletNames() {
  if (cachedNames && Date.now() - cachedAt < 60000) return cachedNames;
  const { rows } = await pool.query(`SELECT name FROM wallets ORDER BY sort_order, id`);
  cachedNames = rows.map((r) => r.name);
  cachedAt = Date.now();
  return cachedNames;
}

export function invalidateWalletCache() {
  cachedNames = null;
}

export async function isValidWallet(wallet) {
  return (await walletNames()).includes(wallet);
}

export async function fallbackWallet() {
  const names = await walletNames();
  return names.includes("Личные") ? "Личные" : names[0];
}
