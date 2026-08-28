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
    // If this name used to belong to a category that was renamed away, its
    // forwarding address (see PUT below) now points somewhere wrong — the
    // name is a real category again, so the alias has to go.
    await pool.query(
      `DELETE FROM category_renames WHERE wallet = $1 AND type = 'expense' AND old_name = $2`,
      [wallet, name.trim()]
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

// Explicit order for one wallet's list, as set by dragging a row by its
// handle in the categories sheet. Takes the full list of names in their new
// order and renumbers sort_order to match — the whole list rather than a
// moved-from/moved-to pair, so a client that was looking at a stale list
// can't interleave its idea of the order with someone else's.
//
// Declared before "/:wallet/:name" for readability only — Express matches on
// segment count, and this path has one segment against that route's two.
categoriesRouter.put("/order", authMiddleware, async (req, res) => {
  const { wallet, names } = req.body;
  const type = req.body.type === "income" ? "income" : "expense";

  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный счёт" });
  }
  if (!Array.isArray(names) || !names.length || !names.every((n) => typeof n === "string")) {
    return res.status(400).json({ error: "Некорректный порядок" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Renumbering by position in the array. Rows the client didn't send
    // (created by the other account between its fetch and this save) keep
    // whatever sort_order they had — they sort after these by id.
    for (let i = 0; i < names.length; i++) {
      await client.query(
        `UPDATE categories SET sort_order = $1 WHERE wallet = $2 AND name = $3 AND type = $4`,
        [i, wallet, names[i], type]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  invalidateCategoryCache();
  res.status(204).end();
});

// Look (emoji/color) and, optionally, the name.
//
// Changing the look needs no migration at all: expenses reference a category
// by name only — no bg/fg/emoji duplicated per row — so every past and future
// expense picks the new look up via the same (wallet, name) lookup the
// frontend already does.
//
// Renaming does need one, because expenses.category is plain text with no FK.
// All of it is one transaction: the category row (whose ON UPDATE CASCADE
// carries category_limits along), every expense that used the old name, and
// the JSON snapshots of any Sheets-sync jobs still queued — those would
// otherwise mirror the old name into the Sheet after the rename. Google
// Sheets rows already written are deliberately NOT rewritten: nothing in the
// app reads the category text back (rows are found by the ID column), so
// that's a manual edit in the Sheet when it's wanted, not ~6 API calls per
// expense against a 60-writes-per-minute quota.
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
  // Optional: an older cached bundle mid-deploy sends no `name` at all, and
  // the edit sheet sends the unchanged one when only the look changed.
  let newName = name;
  if (req.body.name != null) {
    const trimmed = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!trimmed || trimmed.length > 40) {
      return res.status(400).json({ error: "Некорректное название категории" });
    }
    newName = trimmed;
  }
  const renaming = newName !== name;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE categories SET emoji = $1, bg = $2, fg = $3, name = $4
       WHERE wallet = $5 AND name = $6
       RETURNING name, emoji, bg, fg, wallet, type`,
      [emoji, bg, fg, newName, wallet, name]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Категория не найдена" });
    }

    if (renaming) {
      const { type } = rows[0];
      // Not scoped by type on purpose: (wallet, name) is unique across both
      // types, so every expense in this wallet under that name is this
      // category's — and it also catches a row whose type predates the column.
      await client.query(
        `UPDATE expenses SET category = $1 WHERE wallet = $2 AND category = $3`,
        [newName, wallet, name]
      );
      await client.query(
        `UPDATE sheets_sync_jobs
         SET expense_snapshot = jsonb_set(expense_snapshot, '{category}', to_jsonb($1::text))
         WHERE expense_snapshot->>'wallet' = $2 AND expense_snapshot->>'category' = $3`,
        [newName, wallet, name]
      );

      // Forwarding addresses for clients that haven't heard about the rename
      // (see category_renames in db.js). Renaming A→B→C has to re-point A at
      // C too, not leave it aimed at a name that no longer exists.
      await client.query(
        `UPDATE category_renames SET new_name = $1
         WHERE wallet = $2 AND type = $3 AND new_name = $4`,
        [newName, wallet, type, name]
      );
      await client.query(
        `INSERT INTO category_renames (wallet, type, old_name, new_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wallet, type, old_name)
         DO UPDATE SET new_name = EXCLUDED.new_name, created_at = now()`,
        [wallet, type, name, newName]
      );
      // Renamed back to a name it already had: that alias now points at
      // itself, which is just noise.
      await client.query(
        `DELETE FROM category_renames WHERE wallet = $1 AND type = $2 AND old_name = new_name`,
        [wallet, type]
      );
    }

    await client.query("COMMIT");
    invalidateCategoryCache();
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    // (wallet, name) is unique per wallet across BOTH types, so this also
    // fires when an expense category is renamed onto an income one's name.
    // Merging two categories' expenses is never what a rename meant, and it
    // can't be undone — so it's refused rather than guessed at.
    if (err.code === "23505") {
      return res.status(409).json({ error: "Такая категория уже есть" });
    }
    throw err;
  } finally {
    client.release();
  }
});

categoriesRouter.delete("/:wallet/:name", authMiddleware, async (req, res) => {
  // No name is protected — fallbackCategoryFor() (categories.js) resolves
  // the voice/receipt-parsing and create/edit fallback dynamically, so
  // deleting "Прочее"/"Другое" just makes the next category in that wallet
  // the new fallback instead of leaving something pointing at a dead name.
  await pool.query(`DELETE FROM categories WHERE wallet = $1 AND name = $2`, [
    req.params.wallet,
    req.params.name,
  ]);
  invalidateCategoryCache();
  res.status(204).end();
});
