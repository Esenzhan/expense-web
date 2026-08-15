import { Router } from "express";
import { pool } from "../db.js";
import { isValidWallet } from "../wallets.js";
import { getCurrentBalance, setBalance, logBalanceChange } from "../services/balanceHistory.js";

export const debtsRouter = Router();

function isValidDirection(direction) {
  return direction === "owed_to_us" || direction === "we_owe";
}

// Family-scoped debts (user_id NULL) are visible to both accounts (though
// only the creator can settle/pay one — see POST /:id/payments); personal
// ones only to their owner.
debtsRouter.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, u.name AS created_by_name
     FROM debts d
     LEFT JOIN users u ON u.id = d.created_by
     WHERE d.user_id IS NULL OR d.user_id = $1
     ORDER BY (d.status = 'open') DESC, d.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

debtsRouter.get("/:id/payments", async (req, res) => {
  const { id } = req.params;
  const { rows: debtRows } = await pool.query(
    `SELECT id FROM debts WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`,
    [id, req.user.id]
  );
  if (!debtRows.length) return res.status(404).json({ error: "Долг не найден" });

  const { rows } = await pool.query(
    `SELECT p.*, u.name AS changed_by_name
     FROM debt_payments p
     LEFT JOIN users u ON u.id = p.changed_by
     WHERE p.debt_id = $1
     ORDER BY p.created_at DESC`,
    [id]
  );
  res.json(rows);
});

// Creating a debt with a wallet attached moves real money in the model
// right away: lending (owed_to_us) is cash leaving that wallet, borrowing
// (we_owe) is cash arriving — otherwise the site's balance silently drifts
// from the real account the moment that money actually changes hands.
debtsRouter.post("/", async (req, res) => {
  const { direction, scope, counterparty, description, amount, wallet, dueDate, issueDate } = req.body;

  if (!isValidDirection(direction)) {
    return res.status(400).json({ error: "Некорректное направление долга" });
  }
  if (scope !== "personal" && scope !== "family") {
    return res.status(400).json({ error: "Некорректный тип долга" });
  }
  if (typeof counterparty !== "string" || !counterparty.trim()) {
    return res.status(400).json({ error: "Укажите, с кем долг" });
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }
  if (wallet != null && !(await isValidWallet(wallet))) {
    return res.status(400).json({ error: "Некорректный счёт" });
  }
  if (dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return res.status(400).json({ error: "Некорректная дата погашения" });
  }
  if (issueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    return res.status(400).json({ error: "Некорректная дата передачи долга" });
  }

  const userId = scope === "family" ? null : req.user.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (wallet) {
      const oldAmount = (await getCurrentBalance(client, wallet, req.user.id)) ?? 0;
      // owed_to_us: we're lending it out, so it leaves the wallet. we_owe:
      // we're borrowing it, so it arrives. Only the acting (creating)
      // account's own balance on this wallet moves — same as any other
      // balance-affecting action now, see balanceHistory.js.
      const delta = direction === "owed_to_us" ? -amount : amount;
      await setBalance(client, wallet, req.user.id, oldAmount + delta);
      await logBalanceChange(client, {
        wallet,
        oldAmount,
        newAmount: oldAmount + delta,
        reason: direction === "owed_to_us" ? "debt_lend" : "debt_borrow",
        // Not actually a wallet for debt rows — reused to carry who the
        // debt is with, so "История балансов" can show it (see
        // BalanceHistorySheet.jsx's REASON_LABEL).
        counterpartWallet: counterparty.trim(),
        changedBy: req.user.id,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO debts (direction, user_id, counterparty, description, amount, remaining, wallet, created_by, due_date, created_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))
       RETURNING *`,
      [
        direction,
        userId,
        counterparty.trim(),
        description || null,
        amount,
        wallet || null,
        req.user.id,
        dueDate || null,
        issueDate || null,
      ]
    );

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

debtsRouter.post("/:id/payments", async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: debtRows } = await client.query(
      `SELECT * FROM debts WHERE id = $1 AND (user_id IS NULL OR user_id = $2) FOR UPDATE`,
      [id, req.user.id]
    );
    const debt = debtRows[0];
    if (!debt) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Долг не найден" });
    }
    // Family-scoped debts are visible to both accounts, but only whoever
    // actually created it can settle it — a payment re-bases the wallet
    // balance (below), and that must stay tied to the person who agreed to
    // the debt in the first place, not whichever account taps «Погасить» first.
    if (debt.created_by !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Погасить долг может только тот, кто его создал" });
    }
    if (debt.status !== "open") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Долг уже закрыт" });
    }
    if (amount > Number(debt.remaining)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Сумма больше остатка долга" });
    }

    // Repayment always returns to the same wallet the debt was created
    // against (or nowhere, if it was created without one) — no picking a
    // different one at repayment time, so the balance always reconciles
    // with the account the money actually moved through.
    if (debt.wallet) {
      const oldAmount = (await getCurrentBalance(client, debt.wallet, req.user.id)) ?? 0;
      // owed_to_us: they're paying us back, so it arrives. we_owe: we're
      // paying it back, so it leaves.
      const delta = debt.direction === "owed_to_us" ? amount : -amount;
      await setBalance(client, debt.wallet, req.user.id, oldAmount + delta);
      await logBalanceChange(client, {
        wallet: debt.wallet,
        oldAmount,
        newAmount: oldAmount + delta,
        reason: debt.direction === "owed_to_us" ? "debt_repay_in" : "debt_repay_out",
        counterpartWallet: debt.counterparty,
        changedBy: req.user.id,
      });
    }

    await client.query(
      `INSERT INTO debt_payments (debt_id, amount, wallet, changed_by) VALUES ($1, $2, $3, $4)`,
      [id, amount, debt.wallet || null, req.user.id]
    );

    const newRemaining = Number(debt.remaining) - amount;
    const closed = newRemaining <= 0;
    const { rows: updatedRows } = await client.query(
      `UPDATE debts SET remaining = $1, status = $2, closed_at = $3 WHERE id = $4 RETURNING *`,
      [newRemaining, closed ? "closed" : "open", closed ? new Date() : null, id]
    );

    await client.query("COMMIT");
    res.json(updatedRows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// Two safe cases: nothing paid yet (reverse the creation-time wallet
// adjustment, if any, so deleting a just-added mistake doesn't leave a
// phantom balance change behind), or fully settled (remaining 0 — the
// creation delta was already unwound by the repayments themselves, so no
// wallet adjustment is needed). A debt with only a *partial* payment is
// the one case left blocked: neither reversal is complete, so it has to be
// settled down to 0 instead of deleted.
debtsRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: debtRows } = await client.query(
      `SELECT * FROM debts WHERE id = $1 AND (user_id IS NULL OR user_id = $2) FOR UPDATE`,
      [id, req.user.id]
    );
    const debt = debtRows[0];
    if (!debt) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Долг не найден" });
    }
    // Same rule as settling one — see POST /:id/payments.
    if (debt.created_by !== req.user.id) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Удалить долг может только тот, кто его создал" });
    }
    const remaining = Number(debt.remaining);
    const amount = Number(debt.amount);
    const untouched = remaining === amount;
    const fullySettled = debt.status === "closed" && remaining <= 0;
    if (!untouched && !fullySettled) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "По долгу уже были платежи — его нельзя удалить, только погасить" });
    }

    if (debt.wallet && untouched) {
      const oldAmount = (await getCurrentBalance(client, debt.wallet, req.user.id)) ?? 0;
      const delta = debt.direction === "owed_to_us" ? amount : -amount;
      await setBalance(client, debt.wallet, req.user.id, oldAmount + delta);
      await logBalanceChange(client, {
        wallet: debt.wallet,
        oldAmount,
        newAmount: oldAmount + delta,
        reason: "debt_delete",
        counterpartWallet: debt.counterparty,
        changedBy: req.user.id,
      });
    }

    await client.query(`DELETE FROM debts WHERE id = $1`, [id]);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
