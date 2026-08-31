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
