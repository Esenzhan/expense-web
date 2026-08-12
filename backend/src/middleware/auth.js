import jwt from "jsonwebtoken";
import { pool } from "../db.js";

// Shared by the HTTP middleware below and the /ws/voice handshake in
// server.js. Returns the full users row, or null if the token's invalid.
export async function verifyToken(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [payload.sub]);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// Two ways in: a web session JWT (Authorization: Bearer ...) from the
// frontend, or a long-lived per-account key (X-Bot-Key) from the Telegram
// bot. Either way req.user ends up holding the full users row — sheets.js
// needs google_refresh_token/sheet_id off it directly.
export async function authMiddleware(req, res, next) {
  const botKey = req.header("X-Bot-Key");
  if (botKey) {
    const { rows } = await pool.query(`SELECT * FROM users WHERE bot_api_key = $1`, [botKey]);
    if (!rows.length) return res.status(401).json({ error: "Некорректный ключ бота" });
    req.user = rows[0];
    return next();
  }

  const authHeader = req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Не авторизован" });

  const user = await verifyToken(token);
  if (!user) return res.status(401).json({ error: "Не авторизован" });
  req.user = user;
  next();
}
