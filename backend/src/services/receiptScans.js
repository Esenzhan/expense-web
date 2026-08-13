import { pool } from "../db.js";

// Each scan calls Claude Vision regardless of whether the photo turns out to
// be a real receipt, so this caps API spend, not just successful scans.
export const DAILY_SCAN_LIMIT = 10;

// Almaty is UTC+5 year-round (no DST) — a plain offset shift is enough, same
// approach as reminders.js's almatyNow().
function almatyDate() {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Checks the user's count for today and, if under the limit, logs this
// attempt. Returns false when the limit is already hit.
export async function tryLogScan(userId) {
  const today = almatyDate();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM receipt_scans WHERE user_id = $1 AND scan_date = $2`,
    [userId, today]
  );
  if (rows[0].count >= DAILY_SCAN_LIMIT) {
    return false;
  }
  await pool.query(`INSERT INTO receipt_scans (user_id, scan_date) VALUES ($1, $2)`, [
    userId,
    today,
  ]);
  return true;
}
