import Anthropic from "@anthropic-ai/sdk";
import { WALLETS } from "../wallets.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Ты — парсер голосовых записей о тратах для приложения учёта расходов.
Пользователь произносит фразу на русском (иногда с казахскими словами), например:
"Запиши затраты 2500 кофе" или "1200 на такси из бизнеса".

Твоя задача — вернуть ТОЛЬКО JSON без markdown-разметки и пояснений, в формате:
{
  "amount": <число, сумма в тенге>,
  "category": "<короткая категория на русском, например: Кофе, Такси, Продукты, Связь>",
  "description": "<краткое описание, как есть, но чище>",
  "wallet": "<один из: ${WALLETS.join(", ")}>"
}

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

  return parsed;
}
