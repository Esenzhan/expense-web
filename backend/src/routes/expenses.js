import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet } from "../wallets.js";

export const expensesRouter = Router();

// List expenses, optionally filtered by wallet / date range
expensesRouter.get("/", async (req, res) => {
  const { wallet, from, to, limit = 100 } = req.query;
  const conditions = [];
  const values = [];

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

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  values.push(Number(limit));

  const { rows } = await pool.query(
    `SELECT * FROM expenses ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  );
  res.json(rows);
});

// Create an expense — used both for manual entry and to confirm a voice-parsed proposal
expensesRouter.post("/", async (req, res) => {
  const { wallet, amount, category, description, raw_text } = req.body;

  if (!isValidWallet(wallet)) {
    return res.status(400).json({ error: "Некорректный кошелёк" });
  }
  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }

  const { rows } = await pool.query(
    `INSERT INTO expenses (wallet, amount, category, description, raw_text)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [wallet, amount, category || "Прочее", description || null, raw_text || null]
  );
  res.status(201).json(rows[0]);
});

expensesRouter.delete("/:id", async (req, res) => {
  await pool.query(`DELETE FROM expenses WHERE id = $1`, [req.params.id]);
  res.status(204).end();
});
