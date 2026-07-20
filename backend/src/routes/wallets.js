import { Router } from "express";
import { pool } from "../db.js";
import { invalidateWalletCache } from "../wallets.js";

export const walletsRouter = Router();

const isColor = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

function validate({ name, emoji, bg, fg }) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 40) {
    return "Некорректное название счёта";
  }
  if (typeof emoji !== "string" || !emoji || emoji.length > 8) {
    return "Выбери иконку";
  }
  if (!isColor(bg) || !isColor(fg)) {
    return "Некорректный цвет";
  }
  return null;
}

walletsRouter.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT name, emoji, bg, fg FROM wallets ORDER BY sort_order, id`
  );
  res.json(rows);
});

walletsRouter.post("/", async (req, res) => {
  const problem = validate(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const { name, emoji, bg, fg } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO wallets (name, emoji, bg, fg, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM wallets))
       RETURNING name, emoji, bg, fg`,
      [name.trim(), emoji, bg, fg]
    );
    invalidateWalletCache();
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Такой счёт уже есть" });
    }
    throw err;
  }
});

// A wallet can be deleted only while no expenses reference it; "Личные"
// stays as the voice-parse fallback
walletsRouter.delete("/:name", async (req, res) => {
  const name = req.params.name;
  if (name === "Личные") {
    return res.status(400).json({ error: "Этот счёт нельзя удалить" });
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM expenses WHERE wallet = $1`,
    [name]
  );
  if (rows[0].n > 0) {
    return res.status(400).json({ error: "Сначала перенеси или удали траты этого счёта" });
  }
  await pool.query(`DELETE FROM wallets WHERE name = $1`, [name]);
  invalidateWalletCache();
  res.status(204).end();
});

// Edit a wallet; renaming also re-points the expenses that reference it
walletsRouter.put("/:name", async (req, res) => {
  const problem = validate(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const oldName = req.params.name;
  const { name, emoji, bg, fg } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE wallets SET name = $1, emoji = $2, bg = $3, fg = $4
       WHERE name = $5 RETURNING name, emoji, bg, fg`,
      [name.trim(), emoji, bg, fg, oldName]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Счёт не найден" });
    }
    if (name.trim() !== oldName) {
      await client.query(`UPDATE expenses SET wallet = $1 WHERE wallet = $2`, [
        name.trim(),
        oldName,
      ]);
    }
    await client.query("COMMIT");
    invalidateWalletCache();
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "Такой счёт уже есть" });
    }
    throw err;
  } finally {
    client.release();
  }
});
