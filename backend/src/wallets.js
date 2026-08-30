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

// A renamed wallet keeps answering to its old name (see the wallet_renames
// table in db.js): writes from a client that hasn't heard about the rename
// yet — an offline queue flushed afterwards, the other account's phone, a
// tab open since before it — carry the old string. Without this they're
// rejected with 400 "Некорректный кошелёк", and since the offline queue
// stops at its first failure, one such entry blocks the whole queue.
export async function resolveWalletName(wallet) {
  if (!wallet) return null;
  if (await isValidWallet(wallet)) return wallet;
  const { rows } = await pool.query(
    `SELECT new_name FROM wallet_renames WHERE old_name = $1`,
    [wallet]
  );
  const forwarded = rows[0]?.new_name;
  return forwarded && (await isValidWallet(forwarded)) ? forwarded : null;
}

export async function fallbackWallet() {
  const names = await walletNames();
  return names.includes("Личные") ? "Личные" : names[0];
}
