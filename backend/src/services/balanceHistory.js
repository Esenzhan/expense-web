// Same computation as GET /api/wallet-balances, scoped to one wallet — used
// wherever a route needs "what is this wallet's balance right now" before
// changing it (a manual edit's old_amount, either leg of a transfer, or a
// debt's wallet adjustment). These two are the only copies of that sum,
// logged_at cutoff included — keep them identical. Null means this wallet has never had a
// starting balance set for this account — distinct from an actual 0
// balance, so a first-ever edit's history row correctly logs old_amount as
// null instead of a misleading 0.
//
// Every wallet is per-account now, "Семья"/shared ones included — each
// account has its own wallet_balances row and its own checkpoint, and the
// expense subtraction only ever counts that same account's own spending.
// The other account's expenses, debts, and transfers never touch this row.
export async function getCurrentBalance(client, wallet, userId) {
  const { rows } = await client.query(
    `SELECT wb.base_amount - COALESCE((
         SELECT SUM(CASE WHEN e.type = 'income' THEN -e.amount ELSE e.amount END) FROM expenses e
         WHERE e.wallet = wb.wallet AND e.logged_at > wb.base_at AND e.user_id = $2
       ), 0) AS current_balance
     FROM wallet_balances wb
     WHERE wb.wallet = $1 AND wb.user_id = $2`,
    [wallet, userId]
  );
  return rows.length ? Number(rows[0].current_balance) : null;
}

// Re-bases a wallet's balance to `newAmount` as of now, for THIS account
// only — the same upsert PUT /api/wallet-balances/:wallet already did,
// factored out so the transfer/debt routes can apply it inside their own
// transaction.
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
