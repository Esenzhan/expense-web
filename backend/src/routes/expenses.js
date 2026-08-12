import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet, sharedWalletNames } from "../wallets.js";
import { appendExpenseRow, updateExpenseRow, deleteExpenseRow } from "../services/sheets.js";

export const expensesRouter = Router();

// List expenses: visible if it's mine, OR the wallet is shared (Семья/
// Бизнес/Ремонт by default) — shared wallets pool both accounts' rows.
expensesRouter.get("/", async (req, res) => {
  const { wallet, from, to, q, limit = 100 } = req.query;
  const shared = await sharedWalletNames();
  const conditions = [];
  const values = [req.user.id];

  if (shared.length) {
    values.push(shared);
    conditions.push(`(user_id = $1 OR wallet = ANY($${values.length}))`);
  } else {
    conditions.push(`user_id = $1`);
  }

  if (wallet) {
    values.push(wallet);
    conditions.push(`wallet = $${values.length}`);
  }
  if (from) {
    values.push(from);
    conditions.push(`created_at >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    conditions.push(`created_at <= $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    const i = values.length;
    conditions.push(`(description ILIKE $${i} OR category ILIKE $${i} OR amount::text ILIKE $${i})`);
  }

  values.push(Number(limit));

  const { rows } = await pool.query(
    `SELECT * FROM expenses WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  );
  res.json(rows);
});

// Create an expense — used for manual entry, to confirm a voice-parsed
// proposal, and (with created_at) for backfilling historical expenses.
expensesRouter.post("/", async (req, res) => {
  const { wallet, amount, category, description, raw_text, created_at } = req.body;

  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный кошелёк" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }
  let createdAt = null;
  if (created_at != null) {
    createdAt = new Date(created_at);
    if (Number.isNaN(createdAt.getTime())) {
      return res.status(400).json({ error: "Некорректная дата" });
    }
  }

  const { rows } = await pool.query(
    createdAt
      ? `INSERT INTO expenses (wallet, amount, category, description, raw_text, user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`
      : `INSERT INTO expenses (wallet, amount, category, description, raw_text, user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    createdAt
      ? [wallet, amount, category || "Прочее", description || null, raw_text || null, req.user.id, createdAt]
      : [wallet, amount, category || "Прочее", description || null, raw_text || null, req.user.id]
  );
  appendExpenseRow(req.user, rows[0]);
  res.status(201).json(rows[0]);
});

// Edit an existing expense (amount/category/wallet/note) from the edit sheet.
// Shared wallets are visible to both accounts, but only the person who
// actually logged an expense can edit or delete it — the other side sees
// it greyed out and read-only in the UI.
expensesRouter.put("/:id", async (req, res) => {
  const { wallet, amount, category, description } = req.body;

  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный кошелёк" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }

  const { rows: existingRows } = await pool.query(
    `SELECT * FROM expenses WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!existingRows.length) {
    return res.status(404).json({ error: "Трата не найдена" });
  }
  const existing = existingRows[0];

  const { rows } = await pool.query(
    `UPDATE expenses SET wallet = $1, amount = $2, category = $3, description = $4
     WHERE id = $5 RETURNING *`,
    [wallet, amount, category || "Прочее", description || null, req.params.id]
  );

  updateExpenseRow(req.user, rows[0], existing.wallet);
  res.json(rows[0]);
});

expensesRouter.delete("/:id", async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (rows.length) {
    deleteExpenseRow(req.user, rows[0]);
  }
  res.status(204).end();
});
