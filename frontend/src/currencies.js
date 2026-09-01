// Валюты кошельков и позиций капитала. Зеркалит backend/src/currencies.js —
// список обязан совпадать, иначе бэкенд отобьёт то, что фронт даёт выбрать.
//
// Тенге — «домашняя» валюта: в ней ведётся вся семья и бизнес, и только
// тенговые суммы складываются между собой. Валютные кошельки (Alipay в
// юанях, наличные доллары) на главном экране показываются отдельно, своими
// суммами — по устаревшему курсу ничего не пересчитывается, чтобы баланс,
// который сверяют с банком, не начинал тихо врать. Курс применяется ровно в
// одном месте: в снимке капитала, куда его вписывают руками.
export const HOME_CURRENCY = "KZT";

export const CURRENCIES = [
  { code: "KZT", symbol: "₸", name: "Тенге" },
  { code: "USD", symbol: "$", name: "Доллар" },
  { code: "CNY", symbol: "¥", name: "Юань" },
];

const BY_CODE = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

export function currencySymbol(code) {
  return BY_CODE[code]?.symbol || BY_CODE[HOME_CURRENCY].symbol;
}

export function isHomeCurrency(code) {
  return !code || code === HOME_CURRENCY;
}

// Единый формат денег во всём приложении. `decimals: true` — для балансов и
// капитала, где копейки значат (баланс сверяют с банком до копейки);
// по умолчанию без них — для сумм трат в списке, как было раньше.
export function formatMoney(amount, code = HOME_CURRENCY, { decimals = false } = {}) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return `— ${currencySymbol(code)}`;
  const text = n.toLocaleString(
    "ru-RU",
    decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}
  );
  return `${text} ${currencySymbol(code)}`;
}
