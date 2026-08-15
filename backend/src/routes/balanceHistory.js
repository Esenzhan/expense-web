import { Router } from "express";
import { pool } from "../db.js";

export const balanceHistoryRouter = Router();

// Same per-account split as wallet_balances itself now (see db.js/
// balanceHistory.js's comments) — even on a shared wallet, this account
// only ever sees the entries IT made, never the other account's.
balanceHistoryRouter.get("/", async (req, res) => {
  const { wallet } = req.query;
  const { rows } = await pool.query(
    `SELECT bh.id, bh.wallet, bh.old_amount, bh.new_amount, bh.reason,
            bh.counterpart_wallet, bh.changed_by, bh.changed_at,
            u.name AS changed_by_name
     FROM balance_history bh
     LEFT JOIN users u ON u.id = bh.changed_by
     WHERE bh.changed_by = $1
       AND ($2::text IS NULL OR bh.wallet = $2)
     ORDER BY bh.changed_at DESC
     LIMIT 500`,
    [req.user.id, wallet || null]
  );
  res.json(rows);
});
