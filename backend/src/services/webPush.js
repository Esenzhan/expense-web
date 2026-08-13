import webpush from "web-push";
import { pool } from "../db.js";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Sends one push notification. A 404/410 means the subscription is dead
// (user revoked permission, uninstalled the PWA, etc.) — clean it up so
// future ticks stop trying it. A push service that's unreachable/hanging
// (not a clean 404/410) must not be allowed to stall the whole /tick request
// past Render's gateway timeout — 10s is generous for a push send.
export async function sendPush(subscription, payload) {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { timeout: 10000 }
    );
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await pool.query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [
        subscription.endpoint,
      ]);
    } else {
      console.error("Push send failed:", err.statusCode, err.body || err.message);
    }
  }
}
