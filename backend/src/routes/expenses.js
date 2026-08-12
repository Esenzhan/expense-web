import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet, sharedWalletNames } from "../wallets.js";
import { appendExpenseRow, updateExpenseRow, deleteExpenseRow } from "../services/sheets.js";

export const expensesRouter = Router();

// List expenses: visible if it's mine, OR the wallet is shared (Семья/
// Бизнес/Ремонт by default) — shared wallets pool both accounts' rows.
expensesRouter.get("/", async (req, res) => {
  const { wallet, from, to, limit = 100 } = req.query;
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

  values.push(Number(limit));

  const { rows } = await pool.query(
    `SELECT * FROM expenses WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  );
  res.json(rows);
});

// Create an expense — used both for manual entry and to confirm a voice-parsed proposal
expensesRouter.post("/", async (req, res) => {
  const { wallet, amount, category, description, raw_text } = req.body;

  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный кошелёк" });
  }
  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }

  const { rows } = await pool.query(
    `INSERT INTO expenses (wallet, amount, category, description, raw_text, user_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [wallet, amount, category || "Прочее", description || null, raw_text || null, req.user.id]
  );
  appendExpenseRow(req.user, rows[0]);
  res.status(201).json(rows[0]);
});

// Edit an existing expense (amount/category/wallet/note) from the edit sheet.
// Allowed if the wallet is shared, or the caller is the one who logged it.
expensesRouter.put("/:id", async (req, res) => {
  const { wallet, amount, category, description } = req.body;

  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный кошелёк" });
  }
  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }

  const { rows: existingRows } = await pool.query(
    `SELECT * FROM expenses WHERE id = $1`,
    [req.params.id]
  );
  if (!existingRows.length) {
    return res.status(404).json({ error: "Трата не найдена" });
  }
  const existing = existingRows[0];
  const shared = await sharedWalletNames();
  if (existing.user_id !== req.user.id && !shared.includes(existing.wallet)) {
    return res.status(403).json({ error: "Нет доступа к этой трате" });
  }

  const { rows } = await pool.query(
    `UPDATE expenses SET wallet = $1, amount = $2, category = $3, description = $4
     WHERE id = $5 RETURNING *`,
    [wallet, amount, category || "Прочее", description || null, req.params.id]
  );

  // Mirror as the original logger (not whoever's editing) — "Кто" in a
  // shared sheet should reflect who actually spent it.
  const owner =
    existing.user_id === req.user.id
      ? req.user
      : (await pool.query(`SELECT * FROM users WHERE id = $1`, [existing.user_id])).rows[0];
  if (owner) updateExpenseRow(owner, rows[0], existing.wallet);
  res.json(rows[0]);
});

expensesRouter.delete("/:id", async (req, res) => {
  const { rows: existingRows } = await pool.query(
    `SELECT * FROM expenses WHERE id = $1`,
    [req.params.id]
  );
  if (!existingRows.length) {
    return res.status(204).end();
  }
  const existing = existingRows[0];
  const shared = await sharedWalletNames();
  if (existing.user_id !== req.user.id && !shared.includes(existing.wallet)) {
    return res.status(403).json({ error: "Нет доступа к этой трате" });
  }

  await pool.query(`DELETE FROM expenses WHERE id = $1`, [req.params.id]);

  const owner =
    existing.user_id === req.user.id
      ? req.user
      : (await pool.query(`SELECT * FROM users WHERE id = $1`, [existing.user_id])).rows[0];
  if (owner) deleteExpenseRow(owner, existing);
  res.status(204).end();
});
