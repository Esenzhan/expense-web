import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet, sharedWalletNames } from "../wallets.js";

export const walletBalancesRouter = Router();

async function isSharedWallet(wallet) {
  return (await sharedWalletNames()).includes(wallet);
}

// Every wallet that has a balance set up for the current account (shared
// wallets always resolve to the one shared row; "Личные" only to this
// user's own row) — the frontend treats a missing wallet as "not set up
// yet". current_balance is computed here, not stored, so it's always
// consistent with whatever's in `expenses` regardless of how a given row
// got there (manual, voice, bot, offline sync, edit, delete).
walletBalancesRouter.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT wb.wallet, wb.base_amount, wb.base_at,
       wb.base_amount - COALESCE((
         SELECT SUM(e.amount) FROM expenses e
         WHERE e.wallet = wb.wallet AND e.created_at > wb.base_at
           AND (wb.user_id IS NULL OR e.user_id = wb.user_id)
       ), 0) AS current_balance
     FROM wallet_balances wb
     WHERE wb.user_id IS NULL OR wb.user_id = $1`,
    [req.user.id]
  );
  res.json(rows);
});

walletBalancesRouter.put("/:wallet", async (req, res) => {
  const { wallet } = req.params;
  const { amount } = req.body;

  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный счёт" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }

  const shared = await isSharedWallet(wallet);
  const { rows } = await pool.query(
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
    shared ? [wallet, amount] : [wallet, req.user.id, amount]
  );
  res.json({ ...rows[0], current_balance: rows[0].base_amount });
});
