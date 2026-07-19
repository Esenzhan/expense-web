import { anthropic } from "../anthropicClient.js";

const SYSTEM_PROMPT = `Ты — краткий финансовый ассистент в приложении учёта расходов.
По разбивке трат пользователя за период дай ОДИН короткий дружелюбный инсайт на русском
(1-2 предложения): что бросается в глаза, где больше всего денег уходит, или лёгкий совет.
Без markdown, без списков и заголовков — только связный текст.`;

export async function generateInsight(categoryTotals, total, periodLabel) {
  if (!categoryTotals.length) {
    return "Пока недостаточно данных для инсайтов — добавь несколько трат.";
  }

  const breakdown = categoryTotals
    .map((c) => `${c.category}: ${Number(c.total).toLocaleString("ru-RU")} ₸`)
    .join(", ");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Период: ${periodLabel}. Всего потрачено: ${Number(total).toLocaleString("ru-RU")} ₸. Разбивка по категориям: ${breakdown}.`,
      },
    ],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
