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

// A renamed category keeps answering to its old name (see the
// category_renames table in db.js): writes from a client that hasn't heard
// about the rename yet — an offline queue flushed afterwards, the other
// account's phone, a tab open since before it — carry the old string, and
// without this they'd land in "Прочее" via the fallback below.
export async function resolveRenamedCategory(wallet, name, type = "expense") {
  if (!name) return null;
  const { rows } = await pool.query(
    `SELECT new_name FROM category_renames WHERE wallet = $1 AND type = $2 AND old_name = $3`,
    [wallet, type, name]
  );
  return rows[0]?.new_name ?? null;
}

// The single place that decides which category a write actually lands on:
// what was asked for if it's real, else its forwarding address if it was
// renamed, else that wallet's catch-all. Both expense routes (create and
// edit) go through here so the two can't drift apart.
export async function resolveCategoryName(wallet, requested, type = "expense") {
  const fallback = await fallbackCategoryFor(wallet, type);
  const wanted = requested || fallback;
  if (await isValidCategory(wallet, wanted, type)) return wanted;
  const renamed = await resolveRenamedCategory(wallet, wanted, type);
  if (renamed && (await isValidCategory(wallet, renamed, type))) return renamed;
  return fallback;
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
