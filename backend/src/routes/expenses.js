import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet, sharedWalletNames } from "../wallets.js";
import { isValidCategory } from "../categories.js";
import { appendExpenseRow, updateExpenseRow, deleteExpenseRow } from "../services/sheets.js";
import { parseReceiptFromImage, parseReceiptItemsFromImage } from "../services/parseReceipt.js";
import { tryLogScan, DAILY_SCAN_LIMIT } from "../services/receiptScans.js";

export const expensesRouter = Router();

// List expenses: visible if it's mine, OR the wallet is shared (Семья/
// Бизнес/Ремонт by default) — shared wallets pool both accounts' rows.
expensesRouter.get("/", async (req, res) => {
  const { wallet, from, to, q, type, limit = 100 } = req.query;
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
  // Optional — omitted entirely by the main transaction list (shows both
  // expense and income together), passed explicitly as 'expense' by
  // fetchExpensesRange (Insights/"Расходы" must never include income).
  if (type === "expense" || type === "income") {
    values.push(type);
    conditions.push(`type = $${values.length}`);
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

  // A non-numeric ?limit= (malformed link, manual query-string edit) would
  // otherwise become NaN and make pool.query throw on the bind — fall back
  // to the default instead of erroring on a plausible bad input.
  const limitNum = Number(limit);
  values.push(Number.isFinite(limitNum) && limitNum > 0 ? Math.floor(limitNum) : 100);

  const { rows } = await pool.query(
    `SELECT * FROM expenses WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  );
  res.json(rows);
});

// Create an expense — used for manual entry, to confirm a voice-parsed
// proposal, and (with created_at) for backfilling historical expenses.
//
// idempotencyKey is optional, set only by the offline queue's retry loop
// (frontend/src/offlineQueue.js — the entry's localId). That loop can't
// tell "the POST never reached the server" apart from "it did, but the
// response got lost" (a cold Render start is exactly that kind of flaky
// window), so it retries either way — ON CONFLICT DO NOTHING below makes a
// retried create return the original row instead of inserting a second one.
expensesRouter.post("/", async (req, res) => {
  const { wallet, amount, category, description, raw_text, created_at, idempotencyKey } = req.body;
  const type = req.body.type === "income" ? "income" : "expense";

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
  // A category from a different wallet's list (stale client cache, a form
  // that didn't reset on wallet change) would otherwise save silently —
  // same "Прочее"-of-this-wallet fallback the voice/receipt parsers use on
  // a mismatch, not a hard error, since a bad category shouldn't block
  // saving someone's money. The fallback name itself is type-aware: an
  // income row falling back mid-save should land in income's own catch-all,
  // not the expense side's "Прочее" (which isn't even in income's list).
  const fallbackCategory = type === "income" ? "Другое" : "Прочее";
  let finalCategory = category || fallbackCategory;
  if (!(await isValidCategory(wallet, finalCategory, type))) {
    finalCategory = fallbackCategory;
  }

  const { rows } = await pool.query(
    createdAt
      ? `INSERT INTO expenses (wallet, amount, category, description, raw_text, user_id, created_at, idempotency_key, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`
      : `INSERT INTO expenses (wallet, amount, category, description, raw_text, user_id, idempotency_key, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`,
    createdAt
      ? [wallet, amount, finalCategory, description || null, raw_text || null, req.user.id, createdAt, idempotencyKey || null, type]
      : [wallet, amount, finalCategory, description || null, raw_text || null, req.user.id, idempotencyKey || null, type]
  );

  let row = rows[0];
  let isNew = true;
  if (!row && idempotencyKey) {
    // Lost the race to another request with the same key — that one landed
    // the real insert, so hand back its row instead of erroring out.
    const existing = await pool.query(`SELECT * FROM expenses WHERE user_id = $1 AND idempotency_key = $2`, [
      req.user.id,
      idempotencyKey,
    ]);
    row = existing.rows[0];
    isNew = false;
  }
  if (isNew) appendExpenseRow(req.user, row);
  res.status(201).json(row);
});

// Photo → Claude Vision → a proposal, same contract as the voice flow's
// "parsed" message: NOT saved here, the client shows it for confirmation/
// editing and only actually creates the expense via a plain POST / above.
expensesRouter.post("/scan", async (req, res) => {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(req.body.image || "");
  if (!match) {
    return res.status(400).json({ error: "Некорректное изображение" });
  }
  const allowed = await tryLogScan(req.user.id);
  if (!allowed) {
    return res.status(429).json({
      error: `Лимит ${DAILY_SCAN_LIMIT} фото в сутки исчерпан — попробуй завтра`,
    });
  }

  const [, mediaType, base64Data] = match;
  try {
    if (req.body.mode === "split") {
      const proposals = await parseReceiptItemsFromImage(base64Data, mediaType);
      res.json({ proposals });
    } else {
      const proposal = await parseReceiptFromImage(base64Data, mediaType);
      res.json({ proposal });
    }
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// Edit an existing expense (amount/category/wallet/note) from the edit sheet.
// Shared wallets are visible to both accounts, but only the person who
// actually logged an expense can edit or delete it — the other side sees
// it greyed out and read-only in the UI.
expensesRouter.put("/:id", async (req, res) => {
  const { wallet, amount, category, description, created_at } = req.body;

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

  const { rows: existingRows } = await pool.query(
    `SELECT * FROM expenses WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!existingRows.length) {
    return res.status(404).json({ error: "Трата не найдена" });
  }
  const existing = existingRows[0];
  // Falls back to whatever the row already was — the edit sheet always
  // sends its current type, but this keeps an older cached bundle mid-deploy
  // from silently flipping a row's type back to 'expense'.
  const type = req.body.type === "income" || req.body.type === "expense" ? req.body.type : existing.type;

  const fallbackCategory = type === "income" ? "Другое" : "Прочее";
  let finalCategory = category || fallbackCategory;
  if (!(await isValidCategory(wallet, finalCategory, type))) {
    finalCategory = fallbackCategory;
  }

  const { rows } = await pool.query(
    createdAt
      ? `UPDATE expenses SET wallet = $1, amount = $2, category = $3, description = $4, type = $6, created_at = $7
         WHERE id = $5 RETURNING *`
      : `UPDATE expenses SET wallet = $1, amount = $2, category = $3, description = $4, type = $6
         WHERE id = $5 RETURNING *`,
    createdAt
      ? [wallet, amount, finalCategory, description || null, req.params.id, type, createdAt]
      : [wallet, amount, finalCategory, description || null, req.params.id, type]
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
