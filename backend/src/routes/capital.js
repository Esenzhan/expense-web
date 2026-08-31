import { Router } from "express";
import { pool } from "../db.js";

export const capitalRouter = Router();

// Family-wide, unlike debts — no user_id filter, every snapshot is visible
// to both accounts. Total is a live SUM over capital_items rather than a
// stored column (see db.js's comment on the table).
capitalRouter.get("/", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.id, s.created_at, u.name AS created_by_name,
      COALESCE(SUM(i.amount) FILTER (WHERE i.kind = 'asset'), 0) AS assets_total,
      COALESCE(SUM(i.amount) FILTER (WHERE i.kind = 'liability'), 0) AS liabilities_total,
      COALESCE(SUM(i.amount) FILTER (WHERE i.kind = 'asset'), 0)
        - COALESCE(SUM(i.amount) FILTER (WHERE i.kind = 'liability'), 0) AS total
    FROM capital_snapshots s
    LEFT JOIN capital_items i ON i.snapshot_id = s.id
    LEFT JOIN users u ON u.id = s.created_by
    GROUP BY s.id, u.name
    ORDER BY s.created_at DESC
  `);
  res.json(rows);
});

capitalRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { rows: snapRows } = await pool.query(
    `SELECT s.id, s.created_at, u.name AS created_by_name
     FROM capital_snapshots s
     LEFT JOIN users u ON u.id = s.created_by
     WHERE s.id = $1`,
    [id]
  );
  if (!snapRows.length) return res.status(404).json({ error: "Снимок не найден" });

  const { rows: items } = await pool.query(
    `SELECT id, kind, name, amount FROM capital_items WHERE snapshot_id = $1 ORDER BY sort_order, id`,
    [id]
  );
  res.json({ ...snapRows[0], items });
});

// Free-form: each item is just a name + a signed amount the family typed
// in (sometimes scratch arithmetic like a debt already partly repaid), so
// only the shape is validated, not the sign — matches how they've always
// kept this in the spreadsheet.
function validateItems(items) {
  if (!Array.isArray(items) || !items.length) {
    return "Добавьте хотя бы одну позицию";
  }
  for (const item of items) {
    if (item.kind !== "asset" && item.kind !== "liability") {
      return "Некорректный тип позиции";
    }
    if (typeof item.name !== "string" || !item.name.trim()) {
      return "У каждой позиции должно быть название";
    }
    if (typeof item.amount !== "number" || !Number.isFinite(item.amount)) {
      return "Некорректная сумма";
    }
  }
  return null;
}

// The snapshot's own date, overridable from both the create and the edit
// sheet — the family counts on an evening and enters it days later, and the
// number belongs to the day they counted, not the day they typed it in.
// Accepts a full ISO timestamp (what DateTimePickerSheet produces, same
// picker the expense sheets use) as well as the bare YYYY-MM-DD this used
// to take, so an older cached bundle mid-deploy keeps working. Returns
// undefined for "not provided" and null for "provided but unparseable",
// which the callers turn into a 400.
function parseCreatedAt(value) {
  if (value == null) return undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

capitalRouter.post("/", async (req, res) => {
  const { items } = req.body;
  const error = validateItems(items);
  if (error) return res.status(400).json({ error });
  const createdAt = parseCreatedAt(req.body.createdAt);
  if (createdAt === null) {
    return res.status(400).json({ error: "Некорректная дата" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      createdAt
        ? `INSERT INTO capital_snapshots (created_by, created_at) VALUES ($1, $2) RETURNING id, created_at`
        : `INSERT INTO capital_snapshots (created_by) VALUES ($1) RETURNING id, created_at`,
      createdAt ? [req.user.id, createdAt] : [req.user.id]
    );
    const snapshotId = rows[0].id;
    let order = 0;
    for (const item of items) {
      await client.query(
        `INSERT INTO capital_items (snapshot_id, kind, name, amount, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [snapshotId, item.kind, item.name.trim(), item.amount, order++]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({ id: snapshotId, created_at: rows[0].created_at });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// Edits an existing snapshot — wholesale replace of the items rather than a
// diff, same as the create form always submits a full list rather than
// tracking which rows changed. created_at moves too when the edit sheet
// sends one (a snapshot entered under the wrong date is otherwise only
// fixable by deleting and retyping the whole list); created_by stays put —
// it records who did the counting, which re-dating doesn't change.
capitalRouter.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { items } = req.body;
  const error = validateItems(items);
  if (error) return res.status(400).json({ error });
  const createdAt = parseCreatedAt(req.body.createdAt);
  if (createdAt === null) {
    return res.status(400).json({ error: "Некорректная дата" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: snapRows } = await client.query(`SELECT id FROM capital_snapshots WHERE id = $1 FOR UPDATE`, [id]);
    if (!snapRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Снимок не найден" });
    }
    // Only when the client actually sent one — an older bundle that doesn't
    // know about the date field must not blank out an existing snapshot's date.
    if (createdAt !== undefined) {
      await client.query(`UPDATE capital_snapshots SET created_at = $1 WHERE id = $2`, [createdAt, id]);
    }

    await client.query(`DELETE FROM capital_items WHERE snapshot_id = $1`, [id]);
    let order = 0;
    for (const item of items) {
      await client.query(
        `INSERT INTO capital_items (snapshot_id, kind, name, amount, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [id, item.kind, item.name.trim(), item.amount, order++]
      );
    }
    const { rows: saved } = await client.query(
      `SELECT created_at FROM capital_snapshots WHERE id = $1`,
      [id]
    );
    await client.query("COMMIT");
    res.json({ id: Number(id), created_at: saved[0].created_at });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

capitalRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const { rowCount } = await pool.query(`DELETE FROM capital_snapshots WHERE id = $1`, [id]);
  if (!rowCount) return res.status(404).json({ error: "Снимок не найден" });
  res.status(204).end();
});
