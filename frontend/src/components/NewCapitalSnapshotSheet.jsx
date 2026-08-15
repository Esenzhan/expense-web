import { useRef, useState } from "react";
import { createCapitalSnapshot } from "../api";
import { hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CapitalItemsEditor, { emptyRow, rowsToItems } from "./CapitalItemsEditor";

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

  async function handleSave() {
    const items = rowsToItems(assets, liabilities);
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

        <CapitalItemsEditor assets={assets} setAssets={setAssets} liabilities={liabilities} setLiabilities={setLiabilities} />

        {error && <p className="sheet-error">{error}</p>}

        <button className="sheet-close" onClick={handleSave} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
