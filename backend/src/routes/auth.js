import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { getAuthUrl, exchangeCode } from "../services/googleAuth.js";
import { encrypt } from "../services/crypto.js";
import { ensureUserSheet } from "../services/sheets.js";
import { authMiddleware } from "../middleware/auth.js";

export const authRouter = Router();

const allowedEmails = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, {
    expiresIn: "180d",
  });
}

authRouter.get("/google/start", (req, res) => {
  res.redirect(getAuthUrl());
});

authRouter.get("/google/callback", async (req, res) => {
  const frontend = process.env.FRONTEND_URL || "/";
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect(`${frontend}?authError=${encodeURIComponent(error || "no_code")}`);
  }

  try {
    const { tokens, profile } = await exchangeCode(code);
    if (!allowedEmails.includes(profile.email.toLowerCase())) {
      return res.redirect(`${frontend}?authError=not_allowed`);
    }

    const { rows: existing } = await pool.query(`SELECT * FROM users WHERE google_sub = $1`, [
      profile.sub,
    ]);
    let user = existing[0];

    if (!user) {
      const botApiKey = crypto.randomBytes(24).toString("hex");
      const { rows } = await pool.query(
        `INSERT INTO users (email, name, google_sub, avatar_url, google_refresh_token, bot_api_key)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          profile.email,
          profile.name,
          profile.sub,
          profile.picture,
          tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          botApiKey,
        ]
      );
      user = rows[0];
    } else if (tokens.refresh_token) {
      // prompt=consent (always requested) forces Google to hand back a
      // refresh_token on every login, not just the first — keep it current.
      const { rows } = await pool.query(
        `UPDATE users SET google_refresh_token = $1, name = $2, avatar_url = $3 WHERE id = $4 RETURNING *`,
        [encrypt(tokens.refresh_token), profile.name, profile.picture, user.id]
      );
      user = rows[0];
    }

    if (!user.sheet_id) {
      await ensureUserSheet(user);
    }

    res.redirect(`${frontend}?token=${signToken(user)}`);
  } catch (err) {
    console.error("OAuth callback failed:", err);
    res.redirect(`${frontend}?authError=server_error`);
  }
});

authRouter.get("/me", authMiddleware, (req, res) => {
  const { id, email, name, avatar_url } = req.user;
  res.json({ id, email, name, avatar_url });
});
