import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet, sharedWalletNames } from "../wallets.js";
import { isValidCategory } from "../categories.js";

export const categoryLimitsRouter = Router();

// A shared wallet's limits are one row per category (user_id NULL, visible
// to both accounts); a private wallet's ("Личные") limits are one row per
// (category, account), same split as expense visibility elsewhere.
async function isSharedWallet(wallet) {
  return (await sharedWalletNames()).includes(wallet);
}

categoryLimitsRouter.get("/", async (req, res) => {
  const { wallet } = req.query;
  if (!wallet || !(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный счёт" });
  }
  const shared = await isSharedWallet(wallet);
  const { rows } = await pool.query(
    shared
      ? `SELECT category, monthly_limit FROM category_limits WHERE wallet = $1 AND user_id IS NULL`
      : `SELECT category, monthly_limit FROM category_limits WHERE wallet = $1 AND user_id = $2`,
    shared ? [wallet] : [wallet, req.user.id]
  );
  res.json(rows);
});

categoryLimitsRouter.put("/:wallet/:category", async (req, res) => {
  const { wallet, category } = req.params;
  const { monthly_limit } = req.body;

  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный счёт" });
  }
  if (!(await isValidCategory(wallet, category))) {
    return res.status(400).json({ error: "Некорректная категория" });
  }
  if (typeof monthly_limit !== "number" || monthly_limit <= 0) {
    return res.status(400).json({ error: "Некорректный лимит" });
  }

  const shared = await isSharedWallet(wallet);
  const { rows } = await pool.query(
    shared
      ? `INSERT INTO category_limits (wallet, category, user_id, monthly_limit)
         VALUES ($1, $2, NULL, $3)
         ON CONFLICT (wallet, category) WHERE user_id IS NULL
         DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit
         RETURNING category, monthly_limit`
      : `INSERT INTO category_limits (wallet, category, user_id, monthly_limit)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wallet, category, user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit
         RETURNING category, monthly_limit`,
    shared ? [wallet, category, monthly_limit] : [wallet, category, req.user.id, monthly_limit]
  );
  res.json(rows[0]);
});

categoryLimitsRouter.delete("/:wallet/:category", async (req, res) => {
  const { wallet, category } = req.params;
  const shared = await isSharedWallet(wallet);
  await pool.query(
    shared
      ? `DELETE FROM category_limits WHERE wallet = $1 AND category = $2 AND user_id IS NULL`
      : `DELETE FROM category_limits WHERE wallet = $1 AND category = $2 AND user_id = $3`,
    shared ? [wallet, category] : [wallet, category, req.user.id]
  );
  res.status(204).end();
});
