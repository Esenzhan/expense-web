import { haptic } from "../haptics";
import { formatAmountDisplay, sanitizeAmountInput } from "../amountInput";

let nextRowId = 1;
export function emptyRow() {
  return { id: nextRowId++, name: "", amount: "" };
}

// Existing server rows (id is the real capital_items.id, a number) get the
// same {id, name, amount} shape a fresh row has, so the editor never has to
// know which case it's in.
export function rowsFromItems(items) {
  return items.map((item) => ({ id: item.id, name: item.name, amount: String(item.amount) }));
}

export function rowTotal(rows) {
  return rows.reduce((sum, row) => {
    const num = Number(row.amount.replace(",", "."));
    return sum + (row.name.trim() && Number.isFinite(num) ? num : 0);
  }, 0);
}

// Assets/liabilities rows -> the flat {kind, name, amount}[] the API
// expects, dropping any row nobody bothered naming.
export function rowsToItems(assets, liabilities) {
  return [...assets.map((row) => ({ ...row, kind: "asset" })), ...liabilities.map((row) => ({ ...row, kind: "liability" }))]
    .filter((row) => row.name.trim())
    .map((row) => ({
      kind: row.kind,
      name: row.name.trim(),
      amount: Number(row.amount.replace(",", ".")) || 0,
    }));
}

function updateRow(setRows, id, field, value) {
  setRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
}

function Section({ title, rows, setRows }) {
  return (
    <>
      <p className="newcat-group-title">{title}</p>
      {rows.map((row) => (
        <div className="capital-item-row" key={row.id}>
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
export default function CapitalItemsEditor({ assets, setAssets, liabilities, setLiabilities }) {
  const total = rowTotal(assets) - rowTotal(liabilities);
  return (
    <>
      <Section title="Активы" rows={assets} setRows={setAssets} />
      <Section title="Обязательства" rows={liabilities} setRows={setLiabilities} />
      <div className="capital-total-row">
        <span>Итого</span>
        <strong>{total.toLocaleString("ru-RU")} ₸</strong>
      </div>
    </>
  );
}
