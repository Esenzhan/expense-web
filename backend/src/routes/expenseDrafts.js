import { Router } from "express";
import { pool } from "../db.js";

export const expenseDraftsRouter = Router();

// Черновики живут недолго: платёж, который так и не подтвердили за три дня,
// уже не вспомнить, а висеть при каждом открытии приложения он не должен.
const MAX_AGE_DAYS = 3;
// Верхняя граница вменяемости суммы — защита от «12 986 ₸» разобранного как
// 12986000000 при неожиданном формате, а не бизнес-ограничение.
const MAX_AMOUNT = 1e12;

// Сумма из Команд приходит как угодно: числом, «12 986,00 ₸», «1 234.5»,
// с неразрывными пробелами и знаком валюты. Разделитель целой части
// определяем по последнему разделителю в строке: если после него 1–2
// цифры до конца — это дробная часть, иначе всё это разряды.
export function parseAmount(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.abs(raw) : null;
  if (typeof raw !== "string") return null;

  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;

  const lastSep = Math.max(cleaned.lastIndexOf(","), cleaned.lastIndexOf("."));
  const tail = lastSep === -1 ? "" : cleaned.slice(lastSep + 1);
  const isDecimal = lastSep !== -1 && tail.length > 0 && tail.length <= 2 && !tail.includes(",") && !tail.includes(".");

  const digitsOnly = (s) => s.replace(/[.,]/g, "");
  const value = isDecimal
    ? Number(`${digitsOnly(cleaned.slice(0, lastSep))}.${tail}`)
    : Number(digitsOnly(cleaned));

  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null;
  return value;
}

// Сюда шлёт шорткат Команд (заголовок X-Bot-Key — тот же долгоживущий ключ
// аккаунта, что и у бота, см. middleware/auth.js). Тело — {amount,
// description}; amount принимаем и числом, и строкой, потому что в Командах
// сумма почти всегда приезжает уже отформатированной.
expenseDraftsRouter.post("/", async (req, res) => {
  const amount = parseAmount(req.body.amount);
  if (amount === null) {
    return res.status(400).json({ error: "Некорректная сумма" });
  }
  // merchant — на случай, если триггер отдаст название магазина: оно
  // ложится в заметку, её же человек увидит в шторке.
  const description = req.body.description || req.body.note || req.body.merchant || null;
  const { rows } = await pool.query(
    `INSERT INTO expense_drafts (user_id, amount, description, source, raw_text)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.user.id, amount, description, req.body.source || "shortcut", req.body.raw_text || null]
  );
  res.status(201).json(rows[0]);
});

expenseDraftsRouter.get("/", async (req, res) => {
  await pool.query(
    `DELETE FROM expense_drafts WHERE user_id = $1 AND created_at < now() - ($2 || ' days')::interval`,
    [req.user.id, MAX_AGE_DAYS]
  );
  const { rows } = await pool.query(
    `SELECT * FROM expense_drafts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.user.id]
  );
  res.json(rows);
});

// Черновик снимается и когда его сохранили как трату, и когда просто
// закрыли шторку: приложение решает само, ничего лишнего сервер не хранит.
expenseDraftsRouter.delete("/:id", async (req, res) => {
  await pool.query(`DELETE FROM expense_drafts WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  res.status(204).end();
});
