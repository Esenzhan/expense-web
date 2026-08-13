import { Router } from "express";
import { pool } from "../db.js";
import { authMiddleware } from "../middleware/auth.js";
import { sendPush } from "../services/webPush.js";

export const remindersRouter = Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validDays(days) {
  return (
    Array.isArray(days) &&
    days.length <= 7 &&
    days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)
  );
}

// Almaty is UTC+5 year-round (no DST) — a plain offset shift is enough,
// no timezone database needed.
function almatyNow() {
  const shifted = new Date(Date.now() + 5 * 3600 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  const weekday = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay(); // 1=Пн..7=Вс
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}`, weekday };
}

remindersRouter.get("/", authMiddleware, async (req, res) => {
  const { rows } = await pool.query(
    `INSERT INTO reminder_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING enabled, days, time, text`,
    [req.user.id]
  );
  const { rows: subRows } = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM push_subscriptions WHERE user_id = $1) AS has`,
    [req.user.id]
  );
  res.json({ ...rows[0], hasSubscription: subRows[0].has });
});

remindersRouter.put("/", authMiddleware, async (req, res) => {
  const { enabled, days, time, text } = req.body;

  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "Некорректное значение enabled" });
  }
  if (!validDays(days)) {
    return res.status(400).json({ error: "Некорректные дни недели" });
  }
  if (typeof time !== "string" || !TIME_RE.test(time)) {
    return res.status(400).json({ error: "Некорректное время" });
  }
  if (typeof text !== "string" || !text.trim() || text.length > 200) {
    return res.status(400).json({ error: "Некорректный текст напоминания" });
  }

  const { rows } = await pool.query(
    `INSERT INTO reminder_settings (user_id, enabled, days, time, text, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, days = EXCLUDED.days, time = EXCLUDED.time,
           text = EXCLUDED.text, updated_at = now()
     RETURNING enabled, days, time, text`,
    [req.user.id, enabled, days, time, text.trim()]
  );
  res.json(rows[0]);
});

remindersRouter.post("/subscribe", authMiddleware, async (req, res) => {
  const { subscription } = req.body;
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: "Некорректная подписка" });
  }

  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.user.id, endpoint, p256dh, auth]
  );
  res.status(201).json({ ok: true });
});

remindersRouter.delete("/subscribe", authMiddleware, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: "Не указан endpoint" });
  await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2`, [
    endpoint,
    req.user.id,
  ]);
  res.status(204).end();
});

// Called by the GitHub Actions cron tick every 10 minutes — not a logged-in
// user, so it's gated by a shared secret instead of authMiddleware.
remindersRouter.post("/tick", async (req, res) => {
  if (!process.env.REMINDER_CRON_SECRET || req.query.key !== process.env.REMINDER_CRON_SECRET) {
    return res.status(401).json({ error: "Не авторизован" });
  }

  const { date, time, weekday } = almatyNow();
  // ?force=1 skips the once-a-day dedup — for manually re-testing delivery
  // the same calendar day, still gated by the same secret as the rest of
  // /tick, and still respects enabled/day/time.
  const force = req.query.force === "1";
  const { rows: due } = await pool.query(
    force
      ? `SELECT user_id, text FROM reminder_settings
         WHERE enabled = true AND $1 = ANY(days) AND time <= $2`
      : `SELECT user_id, text FROM reminder_settings
         WHERE enabled = true AND $1 = ANY(days) AND time <= $2
           AND (last_sent_date IS NULL OR last_sent_date <> $3::date)`,
    [weekday, time, date]
  );

  let sent = 0;
  for (const row of due) {
    const { rows: subs } = await pool.query(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [row.user_id]
    );
    for (const sub of subs) {
      await sendPush(sub, { title: "Траты", body: row.text });
      sent++;
    }
    await pool.query(`UPDATE reminder_settings SET last_sent_date = $2 WHERE user_id = $1`, [
      row.user_id,
      date,
    ]);
  }

  res.json({ sent, usersDue: due.length });
});
