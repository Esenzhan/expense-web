import { Router } from "express";
import { pool } from "../db.js";
import { sharedWalletNames } from "../wallets.js";

export const statsRouter = Router();

// Same visibility rule as expenses.js: mine, or a shared wallet (pooled
// across both accounts). Pushes params onto `values` and returns the SQL
// fragment referencing them.
async function visibilityWhere(userId, values) {
  const shared = await sharedWalletNames();
  values.push(userId);
  if (!shared.length) return `user_id = $${values.length}`;
  const userIdx = values.length;
  values.push(shared);
  return `(user_id = $${userIdx} OR wallet = ANY($${values.length}))`;
}

// Totals by wallet for the current month (used for the per-wallet cards)
statsRouter.get("/by-wallet", async (req, res) => {
  const values = [];
  const visibility = await visibilityWhere(req.user.id, values);
  const { rows } = await pool.query(
    `SELECT wallet, COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE ${visibility} AND created_at >= date_trunc('month', now())
     GROUP BY wallet`,
    values
  );
  res.json(rows);
});

// Total + category breakdown for a period ("month" | "7" | "30"),
// used for the big spend total and the category chart.
statsRouter.get("/summary", async (req, res) => {
  const { period = "month", wallet } = req.query;
  const values = [];
  const visibility = await visibilityWhere(req.user.id, values);

  let periodClause;
  if (period === "month") {
    periodClause = "created_at >= date_trunc('month', now())";
  } else {
    const days = Number(period) || 30;
    values.push(days);
    periodClause = `created_at >= now() - ($${values.length} || ' days')::interval`;
  }

  let walletFilter = "";
  if (wallet) {
    values.push(wallet);
    walletFilter = `AND wallet = $${values.length}`;
  }

  const { rows } = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE ${visibility} AND ${periodClause} ${walletFilter}
     GROUP BY category
     ORDER BY total DESC`,
    values
  );

  const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
  res.json({ total, categories: rows });
});

// Daily totals, for the trend line chart
statsRouter.get("/daily", async (req, res) => {
  const { days = 30 } = req.query;
  const values = [];
  const visibility = await visibilityWhere(req.user.id, values);
  values.push(Number(days));
  const { rows } = await pool.query(
    `SELECT date_trunc('day', created_at) AS day, COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE ${visibility} AND created_at >= now() - ($${values.length} || ' days')::interval
     GROUP BY day
     ORDER BY day ASC`,
    values
  );
  res.json(rows);
});
