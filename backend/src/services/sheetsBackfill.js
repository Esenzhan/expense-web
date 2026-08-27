import { pool } from "../db.js";
import { enqueueSheetsSync } from "./sheetsSyncQueue.js";

// One-time backfill for expenses created before the durable sync queue
// (sheetsSyncQueue.js) existed — their original append silently failed
// under the old fire-and-forget code and nothing ever retried it. This
// list was produced by reconciling a site CSV export against the actual
// Google Sheets tabs by hand (2026-08-28); it is not derived at runtime.
// TEMPORARY: delete this file and its one call in server.js once the
// sheets-sync-status row in Settings confirms all of these have synced.
// Re-deployed 2026-08-28 to force an immediate retry (reset next_attempt_at)
// right after the account's Google token was refreshed — the prior 5
// attempts were all invalid_grant, so they were otherwise sitting in the
// ~16min backoff window that failure count earns.
const MISSING_EXPENSE_IDS = [
  317, 340, 360, 359, 358, 356, 353, 352, 348, 346, 345, 343, 341, 338, 337,
  335, 334, 326, 325, 322, 321, 318, 315, 313, 311, 308, 305, 304, 303, 299,
  298, 297, 368, 364, 363, 367, 366, 365, 362, 96,
];

export async function backfillMissingSheetsRows() {
  const { rows } = await pool.query(
    `SELECT * FROM expenses WHERE id = ANY($1)`,
    [MISSING_EXPENSE_IDS]
  );
  for (const expense of rows) {
    // Same-owner semantics as a normal create — enqueueSheetsSync resolves
    // targets (including the other account, for shared wallets) from this.
    await enqueueSheetsSync("append", expense.user_id, expense);
  }
  console.log(`Sheets backfill: queued ${rows.length}/${MISSING_EXPENSE_IDS.length} expenses for sync`);
}
