import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet } from "../wallets.js";
import { getCurrentBalance, setBalance, logBalanceChange } from "../services/balanceHistory.js";

export const walletTransfersRouter = Router();

// Moves `amount` from one wallet's balance to another — re-bases both legs
// (same anchor mechanism as a manual "Баланс" edit) inside one transaction,
// and logs both sides to balance_history so the move shows up in each
// wallet's history, linked via counterpart_wallet. A wallet with no balance
// configured yet is treated as starting at 0 rather than rejected, so this
// can also be how a wallet gets its very first balance established.
walletTransfersRouter.post("/", async (req, res) => {
  const { from, to, amount } = req.body;

  if (!(await isValidWallet(from)) || !(await isValidWallet(to))) {
    return res.status(400).json({ error: "Некорректный счёт" });
  }
  if (from === to) {
    return res.status(400).json({ error: "Выберите разные счета" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fromOld = (await getCurrentBalance(client, from, req.user.id)) ?? 0;
    const toOld = (await getCurrentBalance(client, to, req.user.id)) ?? 0;
    const fromNew = fromOld - amount;
    const toNew = toOld + amount;

    const fromUpdated = await setBalance(client, from, req.user.id, fromNew);
    const toUpdated = await setBalance(client, to, req.user.id, toNew);

    await logBalanceChange(client, {
      wallet: from,
      oldAmount: fromOld,
      newAmount: fromNew,
      reason: "transfer_out",
      counterpartWallet: to,
      changedBy: req.user.id,
    });
    await logBalanceChange(client, {
      wallet: to,
      oldAmount: toOld,
      newAmount: toNew,
      reason: "transfer_in",
      counterpartWallet: from,
      changedBy: req.user.id,
    });

    await client.query("COMMIT");
    res.json({ from: fromUpdated, to: toUpdated });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
