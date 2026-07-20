import { anthropic } from "../anthropicClient.js";
import { walletNames, fallbackWallet } from "../wallets.js";
import { pool } from "../db.js";

// Categories now live in the DB (user-creatable), so the parser prompt is
// built per call from the current list. Cached briefly to keep voice
// parsing snappy.
let cachedNames = null;
let cachedAt = 0;

async function categoryNames() {
  if (cachedNames && Date.now() - cachedAt < 60000) return cachedNames;
  const { rows } = await pool.query(`SELECT name FROM categories ORDER BY sort_order, id`);
  cachedNames = rows.map((r) => r.name);
  cachedAt = Date.now();
  return cachedNames;
}

export function invalidateCategoryCache() {
  cachedNames = null;
}

export async function parseExpenseFromText(text) {
  const categories = await categoryNames();
  const wallets = await walletNames();

  const systemPrompt = `Ты — парсер голосовых записей о тратах для приложения учёта расходов.
Пользователь произносит фразу на русском (иногда с казахскими словами), например:
"Запиши затраты 2500 кофе" или "1200 на такси из бизнеса".

Твоя задача — вернуть ТОЛЬКО JSON без markdown-разметки и пояснений, в формате:
{
  "amount": <число, сумма в тенге>,
  "category": "<строго одна из: ${categories.join(", ")}>",
  "description": "<краткое описание, как есть, но чище>",
  "wallet": "<один из: ${wallets.join(", ")}>"
}

Если категория явно не подходит ни под одну из списка — ставь "Прочее".
Если кошелёк явно не назван, ставь "Личные".
Если сумму невозможно распознать — верни amount: null.
Никогда не добавляй ничего, кроме самого JSON-объекта.`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: "user", content: text }],
  });

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Не удалось разобрать ответ модели: ${cleaned}`);
  }

  if (!wallets.includes(parsed.wallet)) {
    parsed.wallet = await fallbackWallet();
  }
  if (!categories.includes(parsed.category)) {
    parsed.category = "Прочее";
  }

  return parsed;
}
