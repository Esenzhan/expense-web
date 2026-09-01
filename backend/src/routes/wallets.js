import { Router } from "express";
import { pool } from "../db.js";
import { invalidateWalletCache } from "../wallets.js";
import { invalidateCategoryCache } from "../categories.js";
import { authMiddleware } from "../middleware/auth.js";
import { renameWalletTab } from "../services/sheets.js";
import { isValidCurrency, HOME_CURRENCY } from "../currencies.js";

export const walletsRouter = Router();

const isColor = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

function validate({ name, emoji, bg, fg, shared, currency }) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 40) {
    return "Некорректное название счёта";
  }
  if (typeof emoji !== "string" || !emoji || emoji.length > 8) {
    return "Выбери иконку";
  }
  if (!isColor(bg) || !isColor(fg)) {
    return "Некорректный цвет";
  }
  if (shared !== undefined && typeof shared !== "boolean") {
    return "Некорректный тип счёта";
  }
  if (currency !== undefined && !isValidCurrency(currency)) {
    return "Некорректная валюта счёта";
  }
  return null;
}

// Defaults to shared, matching both the column default and how every
// wallet created before the toggle existed already behaves — an older
// frontend bundle that doesn't send the field keeps its exact behavior.
const sharedFlag = (body) => (body.shared === undefined ? true : body.shared);
// Тенге по умолчанию — и по смыслу (в ней ведётся всё, кроме Alipay и
// наличных долларов), и для совместимости: старый бандл поля не шлёт.
const currencyOf = (body) => body.currency || HOME_CURRENCY;

// Readable by anyone (the bot needs the list too); creating/editing/deleting
// is site-only, so those require a logged-in user.
walletsRouter.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT name, emoji, bg, fg, shared, currency FROM wallets ORDER BY sort_order, id`
  );
  res.json(rows);
});

walletsRouter.post("/", authMiddleware, async (req, res) => {
  const problem = validate(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const { name, emoji, bg, fg } = req.body;
  const shared = sharedFlag(req.body);
  const currency = currencyOf(req.body);

  try {
    const { rows } = await pool.query(
      `INSERT INTO wallets (name, emoji, bg, fg, shared, currency, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM wallets))
       RETURNING name, emoji, bg, fg, shared, currency`,
      [name.trim(), emoji, bg, fg, shared, currency]
    );
    // A new wallet can reuse a name some older wallet was renamed away
    // from; that stale forwarding row would then point writes meant for
    // this wallet somewhere else entirely.
    await pool.query(`DELETE FROM wallet_renames WHERE old_name = $1`, [name.trim()]);
    invalidateWalletCache();
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Такой счёт уже есть" });
    }
    console.error("Не удалось создать счёт:", err);
    res.status(500).json({ error: "Не удалось создать счёт" });
  }
});

// A wallet can be deleted only while no expenses reference it; "Личные"
// stays as the voice-parse fallback
walletsRouter.delete("/:name", authMiddleware, async (req, res) => {
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

// Edit a wallet. A rename is the interesting case: the wallet's name IS the
// key every other table joins on, so it has to be carried everywhere at
// once — the FK'd tables (categories, wallet_balances, balance_history,
// debts, debt_payments) cascade in the DB, and everything below is a plain
// TEXT column or an external system that can't.
walletsRouter.put("/:name", authMiddleware, async (req, res) => {
  const problem = validate(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const oldName = req.params.name;
  const { name, emoji, bg, fg } = req.body;
  const shared = sharedFlag(req.body);
  const newName = name.trim();
  const renamed = newName !== oldName;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: existing } = await client.query(
      `SELECT currency FROM wallets WHERE name = $1 FOR UPDATE`,
      [oldName]
    );
    if (!existing.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Счёт не найден" });
    }
    // Валюта задаётся при создании и дальше не меняется, пока на счёте
    // что-то есть: сумма хранится числом без валюты, так что смена валюты
    // молча переобъявила бы каждую прошлую трату и весь баланс другими
    // деньгами — 100 юаней стали бы 100 тенге. Пустой счёт переключить
    // можно, там нечего портить.
    const currency = req.body.currency || existing[0].currency;
    if (currency !== existing[0].currency) {
      const { rows: used } = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM expenses WHERE wallet = $1)::int
         + (SELECT COUNT(*) FROM wallet_balances WHERE wallet = $1)::int AS n`,
        [oldName]
      );
      if (used[0].n > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Валюту счёта нельзя поменять — на нём уже есть траты или задан баланс",
        });
      }
    }
    const { rows } = await client.query(
      `UPDATE wallets SET name = $1, emoji = $2, bg = $3, fg = $4, shared = $5, currency = $6
       WHERE name = $7 RETURNING name, emoji, bg, fg, shared, currency`,
      [newName, emoji, bg, fg, shared, currency, oldName]
    );
    if (renamed) {
      await client.query(`UPDATE expenses SET wallet = $1 WHERE wallet = $2`, [newName, oldName]);
      // category_renames is keyed by wallet name and has no FK to cascade
      // through — leaving it behind would silently drop every category
      // forwarding address this wallet had accumulated.
      await client.query(`UPDATE category_renames SET wallet = $1 WHERE wallet = $2`, [
        newName,
        oldName,
      ]);
      // The "other side" of a transfer, also a plain TEXT column: without
      // this the balance history keeps naming a wallet that no longer exists.
      await client.query(
        `UPDATE balance_history SET counterpart_wallet = $1 WHERE counterpart_wallet = $2`,
        [newName, oldName]
      );
      // Sheets jobs queued but not yet flushed carry their own snapshot of
      // the wallet name — they'd write to (or look for) the old tab.
      await client.query(
        `UPDATE sheets_sync_jobs
            SET expense_snapshot = jsonb_set(expense_snapshot, '{wallet}', to_jsonb($1::text))
          WHERE expense_snapshot->>'wallet' = $2`,
        [newName, oldName]
      );
      await client.query(
        `UPDATE sheets_sync_jobs SET previous_wallet = $1 WHERE previous_wallet = $2`,
        [newName, oldName]
      );
      // Forwarding address for writes that still carry the old name (see
      // wallet_renames in db.js). Renaming A→B→C must leave A and B both
      // pointing at C, not A→B→(gone), hence the second statement.
      await client.query(`UPDATE wallet_renames SET new_name = $1 WHERE new_name = $2`, [
        newName,
        oldName,
      ]);
      await client.query(
        `INSERT INTO wallet_renames (old_name, new_name) VALUES ($1, $2)
         ON CONFLICT (old_name) DO UPDATE SET new_name = EXCLUDED.new_name`,
        [oldName, newName]
      );
      // The new name may itself be an old name something was renamed away
      // from; that row would now forward this wallet's own name elsewhere.
      await client.query(`DELETE FROM wallet_renames WHERE old_name = $1`, [newName]);
    }
    await client.query("COMMIT");
    invalidateWalletCache();
    // Renaming cascades to categories.wallet (ON UPDATE CASCADE) — the
    // categories cache is keyed by wallet name, so without this it'd keep
    // serving the old name's (now stale) entry for up to 60s.
    invalidateCategoryCache();
    if (renamed) {
      // Best-effort, and deliberately after COMMIT: the wallet name is also
      // a tab name in each account's Google Sheet, and Google is the one
      // participant that can't join this transaction. Failing here leaves
      // exactly the old behavior (history splits across two tabs) rather
      // than blocking a rename on someone's expired token.
      await renameWalletTab(oldName, newName).catch((err) =>
        console.error(`Не удалось переименовать вкладку Sheets ${oldName} → ${newName}:`, err.message)
      );
    }
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "Такой счёт уже есть" });
    }
    console.error("Не удалось обновить счёт:", err);
    res.status(500).json({ error: "Не удалось обновить счёт" });
  } finally {
    client.release();
  }
});
