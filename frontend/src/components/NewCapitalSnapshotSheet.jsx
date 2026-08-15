import { useRef, useState } from "react";
import { createCapitalSnapshot } from "../api";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { formatAmountDisplay, sanitizeAmountInput } from "../amountInput";

let nextRowId = 1;
function emptyRow() {
  return { id: nextRowId++, name: "", amount: "" };
}

// «Новый снимок» — свайп-down шторка, две свободные секции (как в их
// таблице: Активы/Обязательства), каждая строка — просто название и сумма,
// без привязки к счетам/категориям сайта. Итог = сумма активов минус сумма
// обязательств, посчитан на бэкенде из этого же набора строк.
export default function NewCapitalSnapshotSheet({ onClose, onCreated }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [assets, setAssets] = useState([emptyRow()]);
  const [liabilities, setLiabilities] = useState([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateRow(setRows, id, field, value) {
    setRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setError("");
  }

  function addRow(setRows) {
    haptic();
    setRows((rows) => [...rows, emptyRow()]);
  }

  function removeRow(setRows, id) {
    haptic();
    setRows((rows) => rows.filter((row) => row.id !== id));
  }

  function rowTotal(rows) {
    return rows.reduce((sum, row) => {
      const num = Number(row.amount.replace(",", "."));
      return sum + (row.name.trim() && Number.isFinite(num) ? num : 0);
    }, 0);
  }

  const total = rowTotal(assets) - rowTotal(liabilities);

  async function handleSave() {
    const items = [
      ...assets.map((row) => ({ ...row, kind: "asset" })),
      ...liabilities.map((row) => ({ ...row, kind: "liability" })),
    ]
      .filter((row) => row.name.trim())
      .map((row) => ({
        kind: row.kind,
        name: row.name.trim(),
        amount: Number(row.amount.replace(",", ".")) || 0,
      }));

    if (!items.length) {
      setError("Добавьте хотя бы одну позицию");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createCapitalSnapshot(items);
      hapticHeavy();
      onCreated();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  function renderSection(title, rows, setRows) {
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
              onClick={() => removeRow(setRows, row.id)}
              aria-label="Убрать позицию"
              disabled={rows.length === 1}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="capital-add-row" onClick={() => addRow(setRows)}>
          + Добавить
        </button>
      </>
    );
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Новый снимок</span>
          <span className="icon-button-spacer" />
        </div>

        {renderSection("Активы", assets, setAssets)}
        {renderSection("Обязательства", liabilities, setLiabilities)}

        <div className="capital-total-row">
          <span>Итого</span>
          <strong>{total.toLocaleString("ru-RU")} ₸</strong>
        </div>

        {error && <p className="sheet-error">{error}</p>}

        <button className="sheet-close" onClick={handleSave} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
