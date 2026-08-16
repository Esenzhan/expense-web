// Auto-picks a fitting glyph for a free-form Капитал item name (no manual
// picker like categories/wallets have — these rows come and go too often
// for that, so the icon just follows the name). Reuses CategoryGlyph's
// existing icon set rather than drawing new glyphs, matched by Russian
// keyword substrings. Order matters: earlier rules win, so put more
// specific words (e.g. "ипотека") before generic ones (e.g. "долг").
const KEYWORD_ICONS = [
  { match: ["ипотек"], icon: "🏦" },
  { match: ["кредит", "займ", "рассроч", "ссуд"], icon: "💳" },
  { match: ["квартир", "дом", "жиль", "недвиж", "дач"], icon: "🏠" },
  { match: ["машин", "авто"], icon: "🚗" },
  { match: ["депозит", "вклад"], icon: "🏦" },
  { match: ["налич", "кэш", "cash"], icon: "💵" },
  { match: ["накоплен", "сбереж", "заначк", "копилк"], icon: "🐷" },
  { match: ["акци", "облигац", "инвестиц", "портфель", "брокер", "фонд"], icon: "📈" },
  { match: ["крипто", "биткоин", "bitcoin", "usdt", "eth"], icon: "🪙" },
  { match: ["золот", "украшен", "ювелир", "брильянт", "кольц"], icon: "💍" },
  { match: ["бизнес", "доля", "компан", "стартап"], icon: "🏢" },
  { match: ["телефон", "iphone", "ноутбук", "макбук", "техник"], icon: "📱" },
  { match: ["долж", "долг"], icon: "🤝" },
];

const FALLBACK = { asset: "💰", liability: "💳" };

export function guessCapitalItemIcon(name, kind) {
  const query = (name || "").trim().toLowerCase();
  for (const rule of KEYWORD_ICONS) {
    if (rule.match.some((m) => query.includes(m))) return rule.icon;
  }
  return FALLBACK[kind] || FALLBACK.asset;
}
