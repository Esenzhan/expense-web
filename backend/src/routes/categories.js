import { Router } from "express";
import { pool } from "../db.js";
import { invalidateCategoryCache } from "../services/parseExpense.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT name, emoji, bg, fg FROM categories ORDER BY sort_order, id`
  );
  res.json(rows);
});

categoriesRouter.post("/", async (req, res) => {
  const { name, emoji, bg, fg } = req.body;

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

  try {
    // New categories go after the seeded ones but before "Прочее" (999)
    const { rows } = await pool.query(
      `INSERT INTO categories (name, emoji, bg, fg, sort_order)
       VALUES ($1, $2, $3, $4,
         (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE sort_order < 999))
       RETURNING name, emoji, bg, fg`,
      [name.trim(), emoji, bg, fg]
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

categoriesRouter.delete("/:name", async (req, res) => {
  // "Прочее" is the fallback for voice parsing and old expenses — keep it
  if (req.params.name === "Прочее") {
    return res.status(400).json({ error: "Эту категорию нельзя удалить" });
  }
  await pool.query(`DELETE FROM categories WHERE name = $1`, [req.params.name]);
  invalidateCategoryCache();
  res.status(204).end();
});
