import { Router } from "express";
import { pool } from "../db.js";

export const statsRouter = Router();

// Totals by wallet for the current month (used for the top summary cards)
statsRouter.get("/by-wallet", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT wallet, COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE created_at >= date_trunc('month', now())
    GROUP BY wallet
  `);
  res.json(rows);
});

// Totals by category, for the pie/bar chart
statsRouter.get("/by-category", async (req, res) => {
  const { wallet, days = 30 } = req.query;
  const values = [Number(days)];
  let walletFilter = "";
  if (wallet) {
    values.push(wallet);
    walletFilter = `AND wallet = $${values.length}`;
  }

  const { rows } = await pool.query(
    `
    SELECT category, COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE created_at >= now() - ($1 || ' days')::interval
    ${walletFilter}
    GROUP BY category
    ORDER BY total DESC
  `,
    values
  );
  res.json(rows);
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
