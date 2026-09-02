import { pool } from "./db.js";

// Wallets live in the DB (user-creatable). Cached briefly for the hot paths
// (expense validation, voice parsing, visibility filtering).
let cachedWallets = null; // [{ name, scope, created_by }]
let cachedAt = 0;

async function allWallets() {
  if (cachedWallets && Date.now() - cachedAt < 60000) return cachedWallets;
  const { rows } = await pool.query(`SELECT name, scope, created_by FROM wallets ORDER BY sort_order, id`);
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

// Общие счета (по умолчанию Семья/Бизнес/Ремонт): траты видны обоим
// аккаунтам, складываются в общие итоги, мирроятся в обе Google-таблицы и
// делят один лимит на категорию. Всё остальное — personal и other — у
// каждого аккаунта своё.
export async function sharedWalletNames() {
  return (await allWallets()).filter((w) => w.scope === "shared").map((w) => w.name);
}

// Общим является ТОЛЬКО «Общий». И «Личный», и «Другое» — карманы
// конкретного человека: их видит лишь тот аккаунт, который их завёл.
// Разница между этими двумя группами чисто в том, куда счёт попадёт в
// списке, а не в том, кто его видит.
//
// created_by IS NULL — счета, заведённые до появления владельца (сид:
// Личные/Семья/Бизнес/Ремонт). Их оставляем видимыми всем, иначе на деплое
// личный счёт без владельца исчез бы у обоих сразу. Владельца таким счетам
// проставляют вручную, и с этого момента счёт становится персональным.
export async function visibleWallets(userId) {
  return (await allWallets()).filter(
    (w) =>
      w.scope === "shared" ||
      w.created_by == null ||
      (userId != null && w.created_by === userId)
  );
}

// Можно ли этому аккаунту вообще писать на этот счёт. Без проверки чужой
// счёт из «Другого» принимал бы траты по API, хотя в интерфейсе его не
// видно.
export async function canUseWallet(name, userId) {
  return (await visibleWallets(userId)).some((w) => w.name === name);
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
