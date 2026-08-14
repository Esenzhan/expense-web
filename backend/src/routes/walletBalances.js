import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet } from "../wallets.js";
import { isSharedWallet, getCurrentBalance, setBalance, logBalanceChange } from "../services/balanceHistory.js";

export const walletBalancesRouter = Router();

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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const oldAmount = await getCurrentBalance(client, wallet, req.user.id);
    const updated = await setBalance(client, wallet, req.user.id, shared, amount);
    await logBalanceChange(client, {
      wallet,
      oldAmount,
      newAmount: amount,
      reason: "manual",
      changedBy: req.user.id,
    });
    await client.query("COMMIT");
    res.json(updated);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
