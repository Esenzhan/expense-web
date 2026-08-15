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

capitalRouter.post("/", async (req, res) => {
  const { items } = req.body;
  const error = validateItems(items);
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO capital_snapshots (created_by) VALUES ($1) RETURNING id, created_at`,
      [req.user.id]
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

// Edits an existing snapshot's items — wholesale replace rather than a
// diff, same as the create form always submits a full list rather than
// tracking which rows changed. created_at/created_by stay put; only the
// items (and therefore the computed total) move.
capitalRouter.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { items } = req.body;
  const error = validateItems(items);
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: snapRows } = await client.query(`SELECT id FROM capital_snapshots WHERE id = $1 FOR UPDATE`, [id]);
    if (!snapRows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Снимок не найден" });
    }

    await client.query(`DELETE FROM capital_items WHERE snapshot_id = $1`, [id]);
    let order = 0;
    for (const item of items) {
      await client.query(
        `INSERT INTO capital_items (snapshot_id, kind, name, amount, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [id, item.kind, item.name.trim(), item.amount, order++]
      );
    }
    await client.query("COMMIT");
    res.json({ id: Number(id) });
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
