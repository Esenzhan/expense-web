import { Router } from "express";
import { pool } from "../db.js";

export const statsRouter = Router();

function periodWhere(period) {
  if (period === "month") {
    return { where: "created_at >= date_trunc('month', now())", values: [] };
  }
  const days = Number(period) || 30;
  return { where: "created_at >= now() - ($1 || ' days')::interval", values: [days] };
}

// Totals by wallet for the current month (used for the per-wallet cards)
statsRouter.get("/by-wallet", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT wallet, COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE created_at >= date_trunc('month', now())
    GROUP BY wallet
  `);
  res.json(rows);
});

// Total + category breakdown for a period ("month" | "7" | "30"),
// used for the big spend total and the category chart.
statsRouter.get("/summary", async (req, res) => {
  const { period = "month", wallet } = req.query;
  const { where, values } = periodWhere(period);

  let walletFilter = "";
  if (wallet) {
    values.push(wallet);
    walletFilter = `AND wallet = $${values.length}`;
  }

  const { rows } = await pool.query(
    `SELECT category, COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE ${where} ${walletFilter}
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
  const { rows } = await pool.query(
    `
    SELECT date_trunc('day', created_at) AS day, COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE created_at >= now() - ($1 || ' days')::interval
    GROUP BY day
    ORDER BY day ASC
  `,
    [Number(days)]
  );
  res.json(rows);
});
