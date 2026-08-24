import { Router } from "express";
import { pool } from "../db.js";
import { invalidateCategoryCache } from "../categories.js";
import { isValidWallet } from "../wallets.js";
import { authMiddleware } from "../middleware/auth.js";

export const categoriesRouter = Router();

// Readable by anyone (the bot needs the list to build its parse prompt);
// creating/deleting is site-only, so those two require a logged-in user.
//
// ?type= defaults to 'expense' — every caller that predates income support
// (the bot, an old cached frontend bundle mid-deploy) never sends it, and
// 'expense' is the only type that existed before, so this keeps their
// result identical. The income picker is the only caller that passes
// ?type=income explicitly.
categoriesRouter.get("/", async (req, res) => {
  const { wallet, type } = req.query;
  const resolvedType = type === "income" ? "income" : "expense";
  if (wallet) {
    const { rows } = await pool.query(
      `SELECT name, emoji, bg, fg FROM categories WHERE wallet = $1 AND type = $2 ORDER BY sort_order, id`,
      [wallet, resolvedType]
    );
    return res.json(rows);
  }
  // No wallet filter: every category across every wallet, tagged with its
  // wallet — used for the one-shot frontend hydrate and as a fallback for
  // callers that haven't been updated to pass ?wallet= yet.
  const { rows } = await pool.query(
    `SELECT wallet, name, emoji, bg, fg FROM categories WHERE type = $1 ORDER BY wallet, sort_order, id`,
    [resolvedType]
  );
  res.json(rows);
});

categoriesRouter.post("/", authMiddleware, async (req, res) => {
  const { name, emoji, bg, fg, wallet } = req.body;

  if (typeof name !== "string" || !name.trim() || name.trim().length > 40) {
    return res.status(400).json({ error: "Некорректное название категории" });
  }
  if (typeof emoji !== "string" || !emoji || emoji.length > 8) {
    return res.status(400).json({ error: "Выбери иконку" });
  }
  const isColor = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  if (!isColor(bg) || !isColor(fg)) {
    return res.status(400).json({ error: "Некорректный цвет" });
  }
  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный счёт" });
  }

  try {
    // New categories go after the seeded ones but before "Прочее" (999),
    // scoped to their own wallet's sort order.
    const { rows } = await pool.query(
      `INSERT INTO categories (name, emoji, bg, fg, sort_order, wallet)
       VALUES ($1, $2, $3, $4,
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE sort_order < 999 AND wallet = $5),
         $5)
       RETURNING name, emoji, bg, fg, wallet`,
      [name.trim(), emoji, bg, fg, wallet]
    );
    invalidateCategoryCache(); // voice parser picks the new category up immediately
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Такая категория уже есть" });
    }
    throw err;
  }
});

// Color/icon only — renaming isn't offered here. Expenses reference a
// category by name only (expenses.category is plain text, no bg/fg/emoji
// duplicated per row), so every past and future expense picks up the new
// look automatically via the same (wallet, name) lookup the frontend
// already does — nothing to migrate.
categoriesRouter.put("/:wallet/:name", authMiddleware, async (req, res) => {
  const { wallet, name } = req.params;
  const { emoji, bg, fg } = req.body;

  if (typeof emoji !== "string" || !emoji || emoji.length > 8) {
    return res.status(400).json({ error: "Выбери иконку" });
  }
  const isColor = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  if (!isColor(bg) || !isColor(fg)) {
    return res.status(400).json({ error: "Некорректный цвет" });
  }

  const { rows } = await pool.query(
    `UPDATE categories SET emoji = $1, bg = $2, fg = $3
     WHERE wallet = $4 AND name = $5
     RETURNING name, emoji, bg, fg, wallet`,
    [emoji, bg, fg, wallet, name]
  );
  if (!rows.length) return res.status(404).json({ error: "Категория не найдена" });
  invalidateCategoryCache();
  res.json(rows[0]);
});

categoriesRouter.delete("/:wallet/:name", authMiddleware, async (req, res) => {
  // "Прочее" is the fallback for voice parsing and old expenses — keep it
  if (req.params.name === "Прочее") {
    return res.status(400).json({ error: "Эту категорию нельзя удалить" });
  }
  await pool.query(`DELETE FROM categories WHERE wallet = $1 AND name = $2`, [
    req.params.wallet,
    req.params.name,
  ]);
  invalidateCategoryCache();
  res.status(204).end();
});
