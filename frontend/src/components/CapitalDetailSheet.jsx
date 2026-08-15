import { useEffect, useRef, useState } from "react";
import { fetchCapitalSnapshot, updateCapitalSnapshot, deleteCapitalSnapshot } from "../api";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { almaty } from "../insights";
import TrashIcon from "./TrashIcon";
import CapitalItemsEditor, { emptyRow, rowsFromItems, rowTotal, rowsToItems } from "./CapitalItemsEditor";

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU")} ₸`;
}

function formatDate(iso) {
  const shifted = almaty(new Date(iso));
  return shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

// Открывается тапом по строке в CapitalSheet — тот же редактор строк, что и
// «Новый снимок» (CapitalItemsEditor), только предзаполненный этим
// снимком, плюс удаление всего снимка через «⋮» (как в EditExpenseSheet).
export default function CapitalDetailSheet({ snapshot, previousTotal, onClose, onSaved, onDeleted }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [assets, setAssets] = useState([emptyRow()]);
  const [liabilities, setLiabilities] = useState([emptyRow()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetchCapitalSnapshot(snapshot.id)
      .then((detail) => {
        const loadedAssets = rowsFromItems(detail.items.filter((item) => item.kind === "asset"));
        const loadedLiabilities = rowsFromItems(detail.items.filter((item) => item.kind === "liability"));
        setAssets(loadedAssets.length ? loadedAssets : [emptyRow()]);
        setLiabilities(loadedLiabilities.length ? loadedLiabilities : [emptyRow()]);
      })
      .catch(() => setError("Не удалось загрузить снимок"))
      .finally(() => setLoading(false));
  }, [snapshot.id]);

  async function handleSave() {
    const items = rowsToItems(assets, liabilities);
    if (!items.length) {
      setError("Добавьте хотя бы одну позицию");
      return;
    }
    haptic();
    setSaving(true);
    setError("");
    try {
      await updateCapitalSnapshot(snapshot.id, items);
      hapticHeavy();
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      haptic();
      setConfirmingDelete(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await deleteCapitalSnapshot(snapshot.id);
      hapticHeavy();
      onDeleted();
    } catch (err) {
      setError(err.message);
      setSaving(false);
      setConfirmingDelete(false);
    }
  }

  const total = rowTotal(assets) - rowTotal(liabilities);
  const growth = previousTotal != null ? total - Number(previousTotal) : null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">{formatDate(snapshot.created_at)}</span>
          <div className="edit-menu-wrap">
            <button
              className="icon-button"
              onClick={() => {
                setMenuOpen((open) => !open);
                setConfirmingDelete(false);
              }}
              aria-label="Меню"
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="edit-menu">
                <button
                  className="menu-item danger"
                  onClick={confirmingDelete ? handleDelete : () => setConfirmingDelete(true)}
                  disabled={saving}
                >
                  <span className="menu-item-text" key={confirmingDelete ? "confirm" : "ask"}>
                    {confirmingDelete ? "Точно удалить?" : "Удалить"}
                    <TrashIcon size={16} />
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {growth != null && (
          <p className={`capital-growth-hint capital-growth ${growth >= 0 ? "up" : "down"}`}>
            {growth >= 0 ? "+" : "−"}
            {formatAmount(Math.abs(growth))} к предыдущему снимку
          </p>
        )}

        {snapshot.created_by_name && (
          <div className="settings-group">
            <div className="settings-row">
              <span className="settings-row-label">Посчитал(а)</span>
              <span className="settings-row-value">{snapshot.created_by_name}</span>
            </div>
          </div>
        )}

        {loading && <p className="empty-hint">Загрузка…</p>}
        {error && <p className="sheet-error">{error}</p>}

        {!loading && (
          <CapitalItemsEditor assets={assets} setAssets={setAssets} liabilities={liabilities} setLiabilities={setLiabilities} />
        )}

        {!loading && (
          <button className="sheet-close" onClick={handleSave} disabled={saving}>
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
        )}
      </div>
    </div>
  );
}
