import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet, visibleWallets } from "../wallets.js";
import { getCurrentBalance, getCurrentBalances, setBalance, logBalanceChange } from "../services/balanceHistory.js";

export const walletBalancesRouter = Router();

// Every wallet that has a balance set up for the current account — each
// account has its own row on every wallet now, "Семья"/shared ones
// included, so this only ever returns THIS account's own checkpoints.
// The frontend treats a missing wallet as "not set up yet" for this
// account. current_balance is computed, not stored, so it's always
// consistent with whatever's in `expenses` regardless of how a given row got
// there (manual, voice, bot, offline sync, edit, delete). The formula — and
// the reasoning behind its logged_at cutoff — lives in
// services/balanceHistory.js; it used to be copy-pasted here as well.
walletBalancesRouter.get("/", async (req, res) => {
  // Только по счетам, которые этот аккаунт вообще видит. wallet_balances
  // хранит строку на каждую пару (счёт, аккаунт), и она переживает потерю
  // доступа к счёту: если счёт стал чужим персональным, строка остаётся, а
  // счёт из списка пропадает. Тогда её сумма продолжала бы попадать в «Все
  // счета», хотя ни одной строки под этим числом на экране нет — ровно то
  // расхождение «цифра не сходится со списком», которое тут уже ловили.
  const allowed = new Set((await visibleWallets(req.user.id)).map((w) => w.name));
  const rows = await getCurrentBalances(pool, req.user.id);
  res.json(rows.filter((r) => allowed.has(r.wallet)));
});

walletBalancesRouter.put("/:wallet", async (req, res) => {
  const { wallet } = req.params;
  const { amount } = req.body;

  if (!(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный счёт" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const oldAmount = await getCurrentBalance(client, wallet, req.user.id);
    const updated = await setBalance(client, wallet, req.user.id, amount);
    await logBalanceChange(client, {
      wallet,
      oldAmount,
      newAmount: amount,
      reason: "manual",
      changedBy: req.user.id,
    });
    await client.query("COMMIT");
    res.json(updated);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
