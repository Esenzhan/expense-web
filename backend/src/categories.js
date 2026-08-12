import { pool } from "./db.js";

// Categories live in the DB, one independent list per wallet. Cached
// briefly for the hot paths (voice parsing).
let cachedCategories = null; // [{ wallet, name, emoji, bg, fg }]
let cachedAt = 0;

async function allCategories() {
  if (cachedCategories && Date.now() - cachedAt < 60000) return cachedCategories;
  const { rows } = await pool.query(
    `SELECT wallet, name, emoji, bg, fg FROM categories ORDER BY wallet, sort_order, id`
  );
  cachedCategories = rows;
  cachedAt = Date.now();
  return cachedCategories;
}

export function invalidateCategoryCache() {
  cachedCategories = null;
}

export async function categoryNamesFor(wallet) {
  return (await allCategories()).filter((c) => c.wallet === wallet).map((c) => c.name);
}

export async function isValidCategory(wallet, name) {
  return (await categoryNamesFor(wallet)).includes(name);
}

// { [walletName]: [categoryName, ...] } — used to build the voice-parse
// prompt, which needs every wallet's list at once (wallet and category are
// picked in the same model call).
export async function categoryNamesByWallet() {
  const map = {};
  for (const c of await allCategories()) {
    (map[c.wallet] ??= []).push(c.name);
  }
  return map;
}
