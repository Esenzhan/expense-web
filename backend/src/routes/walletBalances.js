import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet } from "../wallets.js";
import { getCurrentBalance, setBalance, logBalanceChange } from "../services/balanceHistory.js";

export const walletBalancesRouter = Router();

// Every wallet that has a balance set up for the current account — each
// account has its own row on every wallet now, "Семья"/shared ones
// included, so this only ever returns THIS account's own checkpoints.
// The frontend treats a missing wallet as "not set up yet" for this
// account. current_balance is computed here, not stored, so it's always
// consistent with whatever's in `expenses` regardless of how a given row
// got there (manual, voice, bot, offline sync, edit, delete) — and always
// scoped to this account's own expenses, even on a shared wallet (the
// other account's spending must not move a balance you set).
//
// The cutoff is logged_at (when the row was RECORDED), not created_at (the
// date the money was spent, which the edit sheet can set to anything): an
// expense entered now but dated yesterday has to come off a balance set
// this morning. See the logged_at migration in db.js.
walletBalancesRouter.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT wb.wallet, wb.base_amount, wb.base_at,
       wb.base_amount - COALESCE((
         SELECT SUM(CASE WHEN e.type = 'income' THEN -e.amount ELSE e.amount END) FROM expenses e
         WHERE e.wallet = wb.wallet AND e.logged_at > wb.base_at AND e.user_id = $1
       ), 0) AS current_balance
     FROM wallet_balances wb
     WHERE wb.user_id = $1`,
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const oldAmount = await getCurrentBalance(client, wallet, req.user.id);
    const updated = await setBalance(client, wallet, req.user.id, amount);
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
