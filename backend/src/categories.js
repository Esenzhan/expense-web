import { pool } from "./db.js";

// Categories live in the DB, one independent list per wallet (and, since
// income support landed, per type too). Cached briefly for the hot paths
// (voice parsing).
let cachedCategories = null; // [{ wallet, name, emoji, bg, fg, type }]
let cachedAt = 0;

async function allCategories() {
  if (cachedCategories && Date.now() - cachedAt < 60000) return cachedCategories;
  const { rows } = await pool.query(
    `SELECT wallet, name, emoji, bg, fg, type FROM categories ORDER BY wallet, sort_order, id`
  );
  cachedCategories = rows;
  cachedAt = Date.now();
  return cachedCategories;
}

export function invalidateCategoryCache() {
  cachedCategories = null;
}

// Defaults to 'expense' everywhere below — every caller that predates
// income support (the bot's voice-parse prompt, old cached frontend
// bundles mid-deploy) still gets exactly the list it always has.
export async function categoryNamesFor(wallet, type = "expense") {
  return (await allCategories())
    .filter((c) => c.wallet === wallet && c.type === type)
    .map((c) => c.name);
}

export async function isValidCategory(wallet, name, type = "expense") {
  return (await categoryNamesFor(wallet, type)).includes(name);
}

const CONVENTIONAL_FALLBACK_NAME = { expense: "Прочее", income: "Другое" };

// The category assigned when nothing else validates (voice/receipt parsing
// misses, a stale/cross-wallet category sent from the client, etc). Prefers
// "Прочее"/"Другое" if that wallet still has one, otherwise falls back to
// whichever category sorts last there — so "Прочее" no longer has to be
// undeletable just to keep this from pointing at a name that doesn't exist
// (see routes/categories.js DELETE). Returns null only if the wallet has no
// categories of that type at all.
export async function fallbackCategoryFor(wallet, type = "expense") {
  const names = await categoryNamesFor(wallet, type);
  if (!names.length) return null;
  const conventional = CONVENTIONAL_FALLBACK_NAME[type];
  return names.includes(conventional) ? conventional : names[names.length - 1];
}

// { [walletName]: [categoryName, ...] } — used to build the voice-parse
// prompt, which needs every wallet's list at once (wallet and category are
// picked in the same model call). Expense-only: the bot only ever creates
// expenses, so offering income category names here would just be a category
// a spoken expense could never actually validate against.
export async function categoryNamesByWallet() {
  const map = {};
  for (const c of await allCategories()) {
    if (c.type !== "expense") continue;
    (map[c.wallet] ??= []).push(c.name);
  }
  return map;
}
