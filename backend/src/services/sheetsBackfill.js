import { pool } from "../db.js";
import { enqueueSheetsSync } from "./sheetsSyncQueue.js";

// One-time backfill for expenses that never made it into Дария's own
// Google Sheet during the invalid_grant window (2026-08-28 incident) — same
// root cause as the earlier 40-row backfill, just found later because it
// needed her own Sheet (not Есенжан's) to reconcile against.
// TEMPORARY: delete this file and its one call in server.js once the
// sheets-sync-status row in Settings confirms all of these have synced.
const MISSING_EXPENSE_IDS = [333, 332, 331, 330, 329, 328, 327];

export async function backfillMissingSheetsRows() {
  const { rows } = await pool.query(
    `SELECT * FROM expenses WHERE id = ANY($1)`,
    [MISSING_EXPENSE_IDS]
  );
  for (const expense of rows) {
    await enqueueSheetsSync("append", expense.user_id, expense);
  }
  console.log(`Sheets backfill: queued ${rows.length}/${MISSING_EXPENSE_IDS.length} expenses for sync`);
}
