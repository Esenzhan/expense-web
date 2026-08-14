import { pool } from "../db.js";

// Each scan calls Claude Vision regardless of whether the photo turns out to
// be a real receipt, so this caps API spend, not just successful scans.
export const DAILY_SCAN_LIMIT = 10;

// Almaty is UTC+5 year-round (no DST) — a plain offset shift is enough, same
// approach as reminders.js's almatyNow().
function almatyDate() {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Arbitrary fixed namespace for this lock's key1, so it can't collide with
// any other advisory lock this backend might take later.
const SCAN_LOCK_NAMESPACE = 0x5c4a5c00;

// Checks the user's count for today and, if under the limit, logs this
// attempt. Returns false when the limit is already hit.
//
// Count-then-insert as two plain queries is a TOCTOU race: two
// near-simultaneous scans (double-tap, a client retry) can both read the
// same under-the-limit count before either has inserted, letting both
// through. Serialized with a Postgres advisory lock scoped to this user
// (key2 = userId), so a concurrent call for the same user blocks until the
// first one's transaction commits its insert — cheap and exact for a
// per-user daily counter, no extra table/row needed.
export async function tryLogScan(userId) {
  const today = almatyDate();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock($1, $2)`, [SCAN_LOCK_NAMESPACE, userId]);
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM receipt_scans WHERE user_id = $1 AND scan_date = $2`,
      [userId, today]
    );
    if (rows[0].count >= DAILY_SCAN_LIMIT) {
      await client.query("COMMIT");
      return false;
    }
    await client.query(`INSERT INTO receipt_scans (user_id, scan_date) VALUES ($1, $2)`, [
      userId,
      today,
    ]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
