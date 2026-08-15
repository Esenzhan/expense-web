// Same computation as GET /api/wallet-balances, scoped to one wallet — used
// wherever a route needs "what is this wallet's balance right now" before
// changing it (a manual edit's old_amount, either leg of a transfer, or a
// debt's wallet adjustment). Null means this wallet has never had a
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
         SELECT SUM(e.amount) FROM expenses e
         WHERE e.wallet = wb.wallet AND e.created_at > wb.base_at AND e.user_id = $2
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
