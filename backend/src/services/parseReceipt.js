import { anthropic } from "../anthropicClient.js";
import { walletNames, fallbackWallet } from "../wallets.js";
import { categoryNamesByWallet, isValidCategory } from "../categories.js";

// Same idea as parseExpense.js (voice), but the source is a photo instead of
// a transcript — ported from the Telegram bot's extract_expense_from_image,
// which already proved the prompt works well on real receipts.
export async function parseReceiptFromImage(base64Data, mediaType) {
  const categoriesByWallet = await categoryNamesByWallet();
  const wallets = await walletNames();

  const walletCategoryList = wallets
    .map((w) => `- ${w}: ${(categoriesByWallet[w] || []).join(", ")}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
          {
            type: "text",
            text: `Это фото чека или квитанции. Извлеки данные о расходе.

У каждого счёта (кошелька) свой независимый список категорий:
${walletCategoryList}

Верни ТОЛЬКО JSON без markdown-разметки и пояснений, в формате:
{
  "amount": <число, итоговая сумма к оплате>,
  "wallet": "<один из: ${wallets.join(", ")}>",
  "category": "<строго одна из категорий ВЫБРАННОГО счёта, из списка выше>",
  "description": "<название магазина или что куплено, кратко>"
}

Если кошелёк не очевиден из содержимого чека — ставь "Личные".
Если категория явно не подходит ни под одну из списка выбранного счёта — ставь "Прочее".
Если это не чек/квитанция или сумму невозможно разобрать — верни {"error": "не чек"}.
Никогда не добавляй ничего, кроме самого JSON-объекта.`,
          },
        ],
      },
    ],
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
  } catch {
    throw new Error("Не удалось распознать чек");
  }

  if (parsed.error || parsed.amount == null) {
    throw new Error("Не похоже на чек — попробуй сфотографировать чётче");
  }

  if (!wallets.includes(parsed.wallet)) {
    parsed.wallet = await fallbackWallet();
  }
  if (!(await isValidCategory(parsed.wallet, parsed.category))) {
    parsed.category = "Прочее";
  }

  return parsed;
}
