import { pool } from "../db.js";
import { sharedWalletNames } from "../wallets.js";

export async function isSharedWallet(wallet) {
  return (await sharedWalletNames()).includes(wallet);
}

// Same computation as GET /api/wallet-balances, scoped to one wallet — used
// wherever a route needs "what is this wallet's balance right now" before
// changing it (a manual edit's old_amount, or either leg of a transfer).
// Null means this wallet has never had a starting balance set — distinct
// from an actual 0 balance, so a first-ever edit's history row correctly
// logs old_amount as null instead of a misleading 0.
//
// The expense subtraction is always scoped to the requesting user's OWN
// spending — including on a shared wallet's single row (wb.user_id IS
// NULL). A shared wallet's balance you set is a personal correction
// against the real account as you last checked it; someone else logging
// their own coffee shouldn't silently move the number you see, only your
// own spending should. Debts/transfers still re-base that one shared row
// for both accounts via setBalance below — those represent an actual
// agreed change to the real account, not routine day-to-day expenses.
export async function getCurrentBalance(client, wallet, userId) {
  const { rows } = await client.query(
    `SELECT wb.base_amount - COALESCE((
         SELECT SUM(e.amount) FROM expenses e
         WHERE e.wallet = wb.wallet AND e.created_at > wb.base_at AND e.user_id = $2
       ), 0) AS current_balance
     FROM wallet_balances wb
     WHERE wb.wallet = $1 AND (wb.user_id IS NULL OR wb.user_id = $2)`,
    [wallet, userId]
  );
  return rows.length ? Number(rows[0].current_balance) : null;
}

// Re-bases a wallet's balance to `newAmount` as of now — the same upsert
// PUT /api/wallet-balances/:wallet already did, factored out so the
// transfer route can apply it to both legs inside one transaction.
export async function setBalance(client, wallet, userId, shared, newAmount) {
  const { rows } = await client.query(
    shared
      ? `INSERT INTO wallet_balances (wallet, user_id, base_amount, base_at)
         VALUES ($1, NULL, $2, now())
         ON CONFLICT (wallet) WHERE user_id IS NULL
         DO UPDATE SET base_amount = EXCLUDED.base_amount, base_at = EXCLUDED.base_at
         RETURNING wallet, base_amount, base_at`
      : `INSERT INTO wallet_balances (wallet, user_id, base_amount, base_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (wallet, user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET base_amount = EXCLUDED.base_amount, base_at = EXCLUDED.base_at
         RETURNING wallet, base_amount, base_at`,
    shared ? [wallet, newAmount] : [wallet, userId, newAmount]
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
