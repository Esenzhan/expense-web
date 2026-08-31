import { Router } from "express";
import { pool } from "../db.js";
import { sharedWalletNames } from "../wallets.js";
import { almatyMonthRange } from "../services/almatyTime.js";

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

// Totals by wallet for the current month (used for the per-wallet cards).
//
// The month is the ASTANA calendar month, computed the same way the frontend
// computes it (insights.js periodRange). It used to be
// `created_at >= date_trunc('month', now())`, which is the month boundary in
// the SERVER's timezone — UTC on Render — so the first five hours of every
// Astana month landed in the previous one, and the sheet showed a different
// "Этот месяц" total than the main screen right beside it.
//
// The upper bound matters just as much: without it an expense dated into the
// future (the date picker allows that, for a planned payment) counted toward
// this month no matter how far ahead it was.
statsRouter.get("/by-wallet", async (req, res) => {
  const values = [];
  const visibility = await visibilityWhere(req.user.id, values);
  const { start, end } = almatyMonthRange();
  values.push(start, end);
  const { rows } = await pool.query(
    `SELECT wallet, COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE ${visibility} AND type = 'expense'
       AND created_at >= $${values.length - 1} AND created_at < $${values.length}
     GROUP BY wallet`,
    values
  );
  res.json(rows);
});

// Daily totals, for the trend line chart
statsRouter.get("/daily", async (req, res) => {
  const { days = 30 } = req.query;
  const values = [];
  const visibility = await visibilityWhere(req.user.id, values);
  // Same NaN guard as expenses.js's ?limit= — a non-numeric ?days= would
  // otherwise make pool.query throw on the bind.
  const daysNum = Number(days);
  values.push(Number.isFinite(daysNum) && daysNum > 0 ? Math.floor(daysNum) : 30);
  const { rows } = await pool.query(
    // Bucketed by ASTANA day, not the server's UTC day — an expense at
    // 02:00 Astana is 21:00 UTC the day before, and used to be charted
    // against yesterday. The AT TIME ZONE 'UTC' makes the operand a plain
    // timestamp, so this doesn't quietly depend on the session's TimeZone
    // setting the way date_trunc over a timestamptz does. Returned as a plain
    // YYYY-MM-DD string rather than a timestamp: a `timestamp without time
    // zone` comes back through the driver as `new Date("2026-08-31 00:00:00")`,
    // which JS reads in the NODE PROCESS's timezone — so the very same row
    // would report a different day depending on where the server runs.
    `SELECT to_char(date_trunc('day', (created_at AT TIME ZONE 'UTC') + interval '5 hours'), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE ${visibility} AND type = 'expense' AND created_at >= now() - ($${values.length} || ' days')::interval
     GROUP BY day
     ORDER BY day ASC`,
    values
  );
  res.json(rows);
});
