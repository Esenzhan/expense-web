import { anthropic } from "../anthropicClient.js";
import { WALLETS } from "../wallets.js";
import { CATEGORIES } from "../categories.js";

const SYSTEM_PROMPT = `Ты — парсер голосовых записей о тратах для приложения учёта расходов.
Пользователь произносит фразу на русском (иногда с казахскими словами), например:
"Запиши затраты 2500 кофе" или "1200 на такси из бизнеса".

Твоя задача — вернуть ТОЛЬКО JSON без markdown-разметки и пояснений, в формате:
{
  "amount": <число, сумма в тенге>,
  "category": "<строго одна из: ${CATEGORIES.join(", ")}>",
  "description": "<краткое описание, как есть, но чище>",
  "wallet": "<один из: ${WALLETS.join(", ")}>"
}

Если категория явно не подходит ни под одну из списка — ставь "Прочее".
Если кошелёк явно не назван, ставь "Личные".
Если сумму невозможно распознать — верни amount: null.
Никогда не добавляй ничего, кроме самого JSON-объекта.`;

export async function parseExpenseFromText(text) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
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

  if (!WALLETS.includes(parsed.wallet)) {
    parsed.wallet = "Личные";
  }
  if (!CATEGORIES.includes(parsed.category)) {
    parsed.category = "Прочее";
  }

  return parsed;
}
