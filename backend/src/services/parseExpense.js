import { anthropic } from "../anthropicClient.js";
import { walletNames, fallbackWallet } from "../wallets.js";
import { categoryNamesByWallet, isValidCategory } from "../categories.js";

export async function parseExpenseFromText(text) {
  const categoriesByWallet = await categoryNamesByWallet();
  const wallets = await walletNames();

  const walletCategoryList = wallets
    .map((w) => `- ${w}: ${(categoriesByWallet[w] || []).join(", ")}`)
    .join("\n");

  const systemPrompt = `Ты — парсер голосовых записей о тратах для приложения учёта расходов.
Пользователь произносит фразу на русском (иногда с казахскими словами), например:
"Запиши затраты 2500 кофе" или "1200 на такси из бизнеса".

У каждого счёта (кошелька) свой независимый список категорий:
${walletCategoryList}

Твоя задача — вернуть ТОЛЬКО JSON без markdown-разметки и пояснений, в формате:
{
  "amount": <число, сумма в тенге>,
  "wallet": "<один из: ${wallets.join(", ")}>",
  "category": "<строго одна из категорий ВЫБРАННОГО счёта, из списка выше>",
  "description": "<краткое описание, как есть, но чище>"
}

Если кошелёк явно не назван, ставь "Личные".
Если категория явно не подходит ни под одну из списка выбранного счёта — ставь "Прочее".
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
  if (!(await isValidCategory(parsed.wallet, parsed.category))) {
    parsed.category = "Прочее";
  }

  return parsed;
}
