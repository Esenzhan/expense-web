import { pool } from "../db.js";
import { appendExpenseRow, updateExpenseRow, deleteExpenseRow } from "./sheets.js";

// Doubles every retry, capped — a token that's actually expired will never
// succeed no matter how long we wait, but capping means we still notice
// (and re-check) roughly every 30 minutes forever, rather than giving up.
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 30 * 60_000;
// Past this many attempts a job is "stuck" for getSyncStatus's purposes —
// not stopped, just flagged so the site can surface it instead of the
// failure sitting invisible in server logs like before.
const STUCK_AFTER_ATTEMPTS = 5;

function backoffMs(attempts) {
  return Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
}

// Called synchronously (awaited) from the expenses routes, right after the
// Postgres write that made this necessary — a fast local INSERT, not the
// slow Google round-trip, so there's nothing left to lose track of if the
// process dies a moment later. ON CONFLICT coalesces: if this expense
// already has a pending job (e.g. edited twice before either synced), only
// the latest snapshot/kind survives — the earlier one is redundant, not a
// separate change that also needs mirroring.
export async function enqueueSheetsSync(kind, userId, expense, previousWallet = null) {
  await pool.query(
    `INSERT INTO sheets_sync_jobs (expense_id, kind, user_id, expense_snapshot, previous_wallet)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (expense_id) DO UPDATE SET
       kind = EXCLUDED.kind,
       user_id = EXCLUDED.user_id,
       expense_snapshot = EXCLUDED.expense_snapshot,
       previous_wallet = EXCLUDED.previous_wallet,
       attempts = 0,
       last_error = NULL,
       next_attempt_at = now(),
       created_at = now()`,
    [expense.id, kind, userId, JSON.stringify(expense), previousWallet]
  );
}

// Guards against overlapping ticks — a slow Google API round-trip (or a lot
// of due jobs) taking longer than the poll interval shouldn't start a
// second pass over the same rows.
let running = false;

export async function processSheetsSyncQueue() {
  if (running) return;
  running = true;
  try {
    const { rows: jobs } = await pool.query(
      `SELECT * FROM sheets_sync_jobs WHERE next_attempt_at <= now() ORDER BY id LIMIT 20`
    );
    for (const job of jobs) {
      await runJob(job);
    }
  } finally {
    running = false;
  }
}

// googleapis' underlying HTTP client doesn't reliably time out on its own —
// without this, one truly hung request (dead socket, a stuck token refresh)
// would keep `running` (above) true forever and silently freeze every future
// tick, not just this one job.
const JOB_TIMEOUT_MS = 45_000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function runJob(job) {
  const { rows: userRows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [job.user_id]);
  const user = userRows[0];
  if (!user) {
    // The account that logged this no longer exists — nothing sensible left to retry.
    await pool.query(`DELETE FROM sheets_sync_jobs WHERE id = $1`, [job.id]);
    return;
  }
  const expense = job.expense_snapshot;
  try {
    if (job.kind === "append") await withTimeout(appendExpenseRow(user, expense), JOB_TIMEOUT_MS);
    else if (job.kind === "update") await withTimeout(updateExpenseRow(user, expense, job.previous_wallet), JOB_TIMEOUT_MS);
    else if (job.kind === "delete") await withTimeout(deleteExpenseRow(user, expense), JOB_TIMEOUT_MS);
    await pool.query(`DELETE FROM sheets_sync_jobs WHERE id = $1`, [job.id]);
  } catch (err) {
    const attempts = job.attempts + 1;
    console.error(
      `Sheets sync job ${job.id} (${job.kind} #${job.expense_id}) failed on attempt ${attempts}:`,
      err.message
    );
    await pool.query(
      `UPDATE sheets_sync_jobs
       SET attempts = $2, last_error = $3, next_attempt_at = now() + ($4 || ' milliseconds')::interval
       WHERE id = $1`,
      [job.id, attempts, String(err.message || err).slice(0, 500), backoffMs(attempts)]
    );
  }
}

// Powers the "Синхронизация с Google Sheets" row in Settings — pending is
// everything not yet mirrored, stuck is the subset that's been failing
// repeatedly (not just "still waiting for its first, on-time try").
export async function getSyncStatus(userId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS pending,
            count(*) FILTER (WHERE attempts >= $2)::int AS stuck
     FROM sheets_sync_jobs WHERE user_id = $1`,
    [userId, STUCK_AFTER_ATTEMPTS]
  );
  return rows[0];
}
