import { haptic } from "../haptics";
import { formatAmountDisplay, sanitizeAmountInput } from "../amountInput";
import { guessCapitalItemIcon } from "../capitalIcons";
import CategoryGlyph from "./CategoryGlyph";
import { CURRENCIES, HOME_CURRENCY, currencySymbol, formatMoney } from "../currencies";

let nextRowId = 1;
export function emptyRow() {
  return { id: nextRowId++, name: "", amount: "", currency: HOME_CURRENCY };
}

// Existing server rows (id is the real capital_items.id, a number) get the
// same {id, name, amount} shape a fresh row has, so the editor never has to
// know which case it's in.
export function rowsFromItems(items) {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    amount: String(item.amount),
    currency: item.currency || HOME_CURRENCY,
  }));
}

// Сумма строки в СВОЕЙ валюте — как её ввели.
function rowAmount(row) {
  const num = Number(String(row.amount).replace(",", "."));
  return row.name.trim() && Number.isFinite(num) ? num : 0;
}

// Итог в тенге. Курс берётся из `rates` этого же снимка; для тенговых строк
// множитель 1. Если строка в валюте, а курса нет — считать нечем, возвращаем
// null, и интерфейс показывает «укажите курс» вместо неправильного числа.
export function rowTotal(rows, rates = {}) {
  let sum = 0;
  for (const row of rows) {
    const amount = rowAmount(row);
    if (!amount) continue;
    const code = row.currency || HOME_CURRENCY;
    if (code === HOME_CURRENCY) {
      sum += amount;
      continue;
    }
    const rate = Number(rates[code]);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    sum += amount * rate;
  }
  return sum;
}

// Валюты (кроме тенге), которые реально используются в строках — для чего
// спрашивать курс, а для чего нет.
export function usedCurrencies(assets, liabilities) {
  return [
    ...new Set(
      [...assets, ...liabilities]
        .filter((row) => row.name.trim())
        .map((row) => row.currency || HOME_CURRENCY)
        .filter((code) => code !== HOME_CURRENCY)
    ),
  ];
}

// Assets/liabilities rows -> the flat {kind, name, amount}[] the API
// expects, dropping any row nobody bothered naming.
export function rowsToItems(assets, liabilities) {
  return [...assets.map((row) => ({ ...row, kind: "asset" })), ...liabilities.map((row) => ({ ...row, kind: "liability" }))]
    .filter((row) => row.name.trim())
    .map((row) => ({
      kind: row.kind,
      name: row.name.trim(),
      amount: Number(String(row.amount).replace(",", ".")) || 0,
      currency: row.currency || HOME_CURRENCY,
    }));
}

// Курсы в состоянии лежат строками (их печатают в поле); API ждёт числа.
// Пустые и неразобранные значения выбрасываем, иначе бэкенд отобьёт весь
// снимок из-за пустой строки за валюту, которой в позициях уже нет.
export function numericRates(rates) {
  const out = {};
  for (const [code, value] of Object.entries(rates || {})) {
    const num = Number(String(value).replace(",", "."));
    if (Number.isFinite(num) && num > 0) out[code] = num;
  }
  return out;
}

function updateRow(setRows, id, field, value) {
  setRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
}

// Валюта строки переключается по кругу ₸ → $ → ¥ одной маленькой кнопкой:
// отдельный выпадающий список на каждую строку занял бы всю ширину, а
// валютных строк тут единицы из полутора десятков.
function cycleCurrency(code) {
  const i = CURRENCIES.findIndex((c) => c.code === (code || HOME_CURRENCY));
  return CURRENCIES[(i + 1) % CURRENCIES.length].code;
}

function Section({ title, kind, rows, setRows }) {
  return (
    <>
      <p className="newcat-group-title">{title}</p>
      {rows.map((row) => (
        <div className="capital-item-row" key={row.id}>
          <span className={`capital-item-icon ${kind}`}>
            <CategoryGlyph emoji={guessCapitalItemIcon(row.name, kind)} size={17} />
          </span>
          <input
            className="note-input capital-item-name"
            type="text"
            placeholder="Название"
            value={row.name}
            onChange={(event) => updateRow(setRows, row.id, "name", event.target.value)}
          />
          <input
            className="note-input capital-item-amount"
            type="text"
            inputMode="decimal"
            placeholder="Сумма"
            value={formatAmountDisplay(row.amount)}
            onChange={(event) => {
              const raw = sanitizeAmountInput(event.target.value);
              if (raw !== null) updateRow(setRows, row.id, "amount", raw);
            }}
          />
          <button
            type="button"
            className="capital-item-currency"
            onClick={() => {
              haptic();
              updateRow(setRows, row.id, "currency", cycleCurrency(row.currency));
            }}
            aria-label="Валюта позиции"
          >
            {currencySymbol(row.currency)}
          </button>
          <button
            type="button"
            className="capital-item-remove"
            onClick={() => {
              haptic();
              setRows((rows) => rows.filter((r) => r.id !== row.id));
            }}
            aria-label="Убрать позицию"
            disabled={rows.length === 1}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="capital-add-row"
        onClick={() => {
          haptic();
          setRows((rows) => [...rows, emptyRow()]);
        }}
      >
        + Добавить
      </button>
    </>
  );
}

// Активы/Обязательства editor shared by NewCapitalSnapshotSheet (fresh
// rows) and CapitalDetailSheet (editing an existing snapshot's rows) — same
// free-form name+amount shape either way, no wallet/category tie-in.
export default function CapitalItemsEditor({ assets, setAssets, liabilities, setLiabilities, rates = {}, setRates }) {
  const needed = usedCurrencies(assets, liabilities);
  const assetsTotal = rowTotal(assets, rates);
  const liabilitiesTotal = rowTotal(liabilities, rates);
  const total = assetsTotal == null || liabilitiesTotal == null ? null : assetsTotal - liabilitiesTotal;

  return (
    <>
      <Section title="Активы" kind="asset" rows={assets} setRows={setAssets} />
      <Section title="Обязательства" kind="liability" rows={liabilities} setRows={setLiabilities} />

      {/* Курс спрашиваем только за те валюты, что реально используются в строках, и
          прямо здесь — на момент подсчёта капитала, а не «вообще». Между
          снимками это и позволяет отделить прирост от курса. */}
      {needed.length > 0 && setRates && (
        <>
          <p className="newcat-group-title">Курс на дату снимка</p>
          {needed.map((code) => (
            <div className="capital-item-row" key={code}>
              <span className="capital-item-icon asset">{currencySymbol(code)}</span>
              <span className="note-input capital-item-name capital-rate-label">
                1 {currencySymbol(code)} в тенге
              </span>
              <input
                className="note-input capital-item-amount"
                type="text"
                inputMode="decimal"
                placeholder="Курс"
                value={formatAmountDisplay(rates[code] == null ? "" : String(rates[code]))}
                onChange={(event) => {
                  const raw = sanitizeAmountInput(event.target.value);
                  if (raw !== null) setRates({ ...rates, [code]: raw });
                }}
              />
            </div>
          ))}
        </>
      )}

      <div className="capital-total-row">
        <span>Итого</span>
        <strong>{total == null ? "укажите курс" : formatMoney(total, HOME_CURRENCY)}</strong>
      </div>
    </>
  );
}
