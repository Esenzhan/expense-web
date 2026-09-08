// Единственная копия формулы «сколько на счету прямо сейчас»: опорная сумма
// минус всё, что записано ПОСЛЕ опорной точки. Раньше тот же SQL жил ещё и в
// GET /api/wallet-balances, и правку приходилось помнить в двух местах.
//
// Отрез по logged_at («когда внесли»), а не created_at («когда потрачено»,
// её можно поменять в шторке правки): трата, внесённая сегодня задним
// числом, обязана уменьшить баланс, выставленный утром. И наоборот —
// logged_at никогда не бывает в будущем, иначе запись вычлась бы дважды
// (см. setBalance ниже и разовый ремонт в db.js).
//
// e.user_id = wb.user_id, а не параметр: wb уже отфильтрован по аккаунту, и
// без параметра выражение можно подставлять в любой запрос. Каждый счёт
// теперь персчётный, «Семья» включительно — траты второго аккаунта, его
// долги и переводы этот баланс не двигают.
const CURRENT_BALANCE_EXPR = `wb.base_amount - COALESCE((
       SELECT SUM(CASE WHEN e.type = 'income' THEN -e.amount ELSE e.amount END) FROM expenses e
       WHERE e.wallet = wb.wallet AND e.logged_at > wb.base_at AND e.user_id = wb.user_id
     ), 0)`;

// Баланс одного счёта. Null — счёту ни разу не задавали стартовую сумму для
// этого аккаунта; это не то же самое, что баланс 0, поэтому первая правка
// пишет в историю old_amount = null, а не вводящий в заблуждение ноль.
export async function getCurrentBalance(client, wallet, userId) {
  const { rows } = await client.query(
    `SELECT ${CURRENT_BALANCE_EXPR} AS current_balance
     FROM wallet_balances wb
     WHERE wb.wallet = $1 AND wb.user_id = $2`,
    [wallet, userId]
  );
  return rows.length ? Number(rows[0].current_balance) : null;
}

// Все счета аккаунта разом — для GET /api/wallet-balances и для истории
// баланса, которой нужна точка отсчёта, чтобы отмотать остаток назад.
export async function getCurrentBalances(client, userId) {
  const { rows } = await client.query(
    `SELECT wb.wallet, wb.base_amount, wb.base_at, ${CURRENT_BALANCE_EXPR} AS current_balance
     FROM wallet_balances wb
     WHERE wb.user_id = $1`,
    [userId]
  );
  return rows;
}

export async function setBalance(client, wallet, userId, newAmount) {
  // Everything the caller just folded into `newAmount` (via getCurrentBalance)
  // has to end up at or before the new base_at, or the very next read
  // subtracts it a SECOND time — and again on every re-base after that.
  // Only a logged_at in the future can break that invariant, since base_at
  // is now(): the row gets counted into the new base_amount and still
  // satisfies `logged_at > base_at` afterwards. logged_at means "when this
  // was recorded", so a future value is corrupt by definition (see the
  // one-time repair in db.js for where the existing ones came from);
  // clamping it to this checkpoint is the honest reading. Normally matches
  // zero rows.
  await client.query(
    `UPDATE expenses SET logged_at = now()
     WHERE wallet = $1 AND user_id = $2 AND logged_at > now()`,
    [wallet, userId]
  );
  const { rows } = await client.query(
    `INSERT INTO wallet_balances (wallet, user_id, base_amount, base_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (wallet, user_id) WHERE user_id IS NOT NULL
     DO UPDATE SET base_amount = EXCLUDED.base_amount, base_at = EXCLUDED.base_at
     RETURNING wallet, base_amount, base_at`,
    [wallet, userId, newAmount]
  );
  return { ...rows[0], current_balance: rows[0].base_amount };
}

export async function logBalanceChange(client, { wallet, oldAmount, newAmount, reason, counterpartWallet, changedBy }) {
  await client.query(
    `INSERT INTO balance_history (wallet, old_amount, new_amount, reason, counterpart_wallet, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [wallet, oldAmount, newAmount, reason, counterpartWallet || null, changedBy]
  );
}

// Знаковый вклад записи в баланс: трата уменьшает остаток, доход увеличивает.
function signedAmount(row) {
  return row.type === "income" ? -Number(row.amount) : Number(row.amount);
}

// Правка и удаление записи, которая старше опорной точки счёта.
//
// Формула выше вычитает только то, что записано ПОСЛЕ base_at: всё, что
// старше, уже свёрнуто внутрь base_amount. Для создания записи это неважно
// (у новой строки logged_at = now(), она всегда попадает в вычитаемую
// часть), но правка и удаление трогают как раз старые строки — и до этой
// функции не двигали баланс вообще: уменьшил трату 15 августа после того,
// как в сентябре выставил баланс руками, — и остаток не менялся, потому
// что менять было нечего, старая сумма сидела в base_amount.
//
// Поэтому здесь ровно на дельту правится сама опорная сумма. logged_at при
// правке не меняется (иначе запись перепрыгнула бы через опорную точку и
// вычлась бы второй раз), так что «свёрнута ли она» определяется её
// собственным logged_at на каждом из затронутых счетов отдельно — при
// смене счёта строка может быть старой для одного и новой для другого.
//
// before/after — строки `expenses` до и после операции (null = записи не
// было / больше нет). Возвращает Map счёт → на сколько сдвинули
// base_amount, чтобы вызывающий записал это в журнал (0 не попадает).
export async function reconcileExpenseChange(client, userId, before, after) {
  const wallets = [...new Set([before?.wallet, after?.wallet].filter(Boolean))].sort();
  const deltas = new Map();
  if (!wallets.length) return deltas;

  // FOR UPDATE + сортировка по имени счёта: две одновременные правки по
  // одной паре счетов иначе могли бы взять строки в разном порядке и
  // встать в дедлок, а без блокировки — потерять одну из дельт.
  const { rows } = await client.query(
    `SELECT wallet, base_at FROM wallet_balances
     WHERE user_id = $1 AND wallet = ANY($2) ORDER BY wallet FOR UPDATE`,
    [userId, wallets]
  );
  // Счёт без опорной точки для этого аккаунта — баланс ему не задавали,
  // двигать нечего.
  const baseAt = new Map(rows.map((r) => [r.wallet, new Date(r.base_at)]));
  const isFoldedIn = (row) => baseAt.has(row.wallet) && new Date(row.logged_at) <= baseAt.get(row.wallet);
  const bump = (wallet, delta) => deltas.set(wallet, (deltas.get(wallet) || 0) + delta);

  // Убрали старую версию записи из опорной суммы, внесли новую. Совпадает
  // счёт — дельты складываются в одну (разницу сумм), разошёлся — каждый
  // счёт правится сам по себе.
  if (before && isFoldedIn(before)) bump(before.wallet, signedAmount(before));
  if (after && isFoldedIn(after)) bump(after.wallet, -signedAmount(after));

  for (const [wallet, delta] of [...deltas]) {
    // До копеек: дельта складывается из сумм в JS, и 2606.84 - 2600.13 там
    // даёт 6.710000000000036 — а base_amount NUMERIC, он сохранил бы этот
    // хвост целиком и таскал его по всей истории счёта.
    const rounded = Math.round(delta * 100) / 100;
    if (!rounded) {
      deltas.delete(wallet);
      continue;
    }
    deltas.set(wallet, rounded);
    await client.query(
      `UPDATE wallet_balances SET base_amount = base_amount + $3 WHERE user_id = $1 AND wallet = $2`,
      [userId, wallet, rounded]
    );
  }
  return deltas;
}

// То же самое, но сразу с записью в журнал балансов — этим пользуются
// роуты правки и удаления траты.
//
// В журнал попадает ТОЛЬКО поправка опорной суммы, и только когда она
// ненулевая. Правка свежей записи (моложе опорной точки) баланс тоже
// меняет, но там его пересчитывает сама формула, а сама запись уже стоит
// в журнале отдельным событием — добавить рядом ещё и «правку опорной
// суммы» значило бы посчитать одно движение дважды, и остатки в истории
// разъехались бы ниже по цепочке.
//
// old_amount = новый баланс минус дельта: это ровно тот остаток, что был
// на счету до правки, от него история и продолжает мотать назад.
export async function applyExpenseChangeToBalances(client, userId, before, after, reason) {
  const deltas = await reconcileExpenseChange(client, userId, before, after);
  for (const [wallet, delta] of deltas) {
    const newAmount = await getCurrentBalance(client, wallet, userId);
    // Счёт без опорной точки сюда не доходит (дельта была бы нулевой), но
    // на всякий случай: без баланса писать в журнал нечего.
    if (newAmount == null) continue;
    await logBalanceChange(client, {
      wallet,
      oldAmount: Math.round((newAmount - delta) * 100) / 100,
      newAmount,
      reason,
      changedBy: userId,
    });
  }
}
