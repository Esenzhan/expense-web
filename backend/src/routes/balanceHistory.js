import { Router } from "express";
import { pool } from "../db.js";

export const balanceHistoryRouter = Router();

// A shared wallet's history is visible to both accounts (same visibility
// rule as its balance/expenses); a private wallet's history only shows
// entries this account itself made — which is all of them, since only the
// owning account can ever change its own private wallet's balance.
balanceHistoryRouter.get("/", async (req, res) => {
  const { wallet } = req.query;
  const { rows } = await pool.query(
    `SELECT bh.id, bh.wallet, bh.old_amount, bh.new_amount, bh.reason,
            bh.counterpart_wallet, bh.changed_by, bh.changed_at,
            u.name AS changed_by_name
     FROM balance_history bh
     JOIN wallets w ON w.name = bh.wallet
     LEFT JOIN users u ON u.id = bh.changed_by
     WHERE (w.shared OR bh.changed_by = $1)
       AND ($2::text IS NULL OR bh.wallet = $2)
     ORDER BY bh.changed_at DESC
     LIMIT 500`,
    [req.user.id, wallet || null]
  );
  res.json(rows);
});
