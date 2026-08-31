import { useEffect, useRef, useState } from "react";
import { fetchCapitalSnapshot, updateCapitalSnapshot, deleteCapitalSnapshot } from "../api";
import { haptic, hapticHeavy, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { almaty } from "../insights";
import { loadCached, saveCached } from "../offlineCache";
import TrashIcon from "./TrashIcon";
import CapitalItemsEditor, { emptyRow, rowsFromItems, rowTotal, rowsToItems } from "./CapitalItemsEditor";
import DateTimePickerSheet from "./DateTimePickerSheet";
import CalendarIcon from "./CalendarIcon";

// Shared with NewCapitalSnapshotSheet's prefill fetch — same snapshot id,
// same cached detail, so a snapshot viewed once is available offline both
// for re-editing and for prefilling the next new snapshot.
export function capitalDetailCacheKey(id) {
  return `traty-capital-detail-${id}`;
}

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU")} ₸`;
}

function formatDate(value) {
  const shifted = almaty(new Date(value));
  return shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

// Открывается тапом по строке в CapitalSheet — тот же редактор строк, что и
// «Новый снимок» (CapitalItemsEditor), только предзаполненный этим
// снимком, плюс удаление всего снимка через «⋮» (как в EditExpenseSheet).
export default function CapitalDetailSheet({ user, snapshot, previousTotal, onClose, onSaved, onDeleted }) {
  const email = user?.email;
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const cacheKey = capitalDetailCacheKey(snapshot.id);
  const cachedItems = loadCached(cacheKey, email);
  const [assets, setAssets] = useState(() => {
    const rows = cachedItems ? rowsFromItems(cachedItems.filter((item) => item.kind === "asset")) : [];
    return rows.length ? rows : [emptyRow()];
  });
  const [liabilities, setLiabilities] = useState(() => {
    const rows = cachedItems ? rowsFromItems(cachedItems.filter((item) => item.kind === "liability")) : [];
    return rows.length ? rows : [emptyRow()];
  });
  const [loading, setLoading] = useState(() => !cachedItems);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Unlike the create sheet's null-until-touched, an existing snapshot
  // starts at its own date (so the picker opens on when the count actually
  // happened) and is always sent back on save; `dateChanged` only drives
  // the calendar button's highlight. Same split as EditExpenseSheet.
  const [customDate, setCustomDate] = useState(() => new Date(snapshot.created_at));
  const [dateChanged, setDateChanged] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  useEffect(() => {
    const cached = loadCached(cacheKey, email);
    fetchCapitalSnapshot(snapshot.id)
      .then((detail) => {
        const loadedAssets = rowsFromItems(detail.items.filter((item) => item.kind === "asset"));
        const loadedLiabilities = rowsFromItems(detail.items.filter((item) => item.kind === "liability"));
        setAssets(loadedAssets.length ? loadedAssets : [emptyRow()]);
        setLiabilities(loadedLiabilities.length ? loadedLiabilities : [emptyRow()]);
        if (email) saveCached(cacheKey, email, detail.items);
      })
      .catch(() => {
        // Offline or the request failed — if this snapshot's items were
        // already cached (hydrated at mount), leave those showing instead
        // of blocking on an error.
        if (!cached) setError("Не удалось загрузить снимок");
      })
      .finally(() => setLoading(false));
  }, [snapshot.id, email]);

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
      await updateCapitalSnapshot(snapshot.id, items, customDate.toISOString());
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
    <>
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">{formatDate(customDate)}</span>
          <div className="edit-header-actions">
            <button
              className={`icon-button ${dateChanged ? "active" : ""}`}
              onClick={() => {
                haptic();
                setDatePickerOpen(true);
              }}
              aria-label="Дата снимка"
            >
              <CalendarIcon />
            </button>
            <div className="edit-menu-wrap">
            <button
              className="icon-button"
              onClick={() => {
                haptic();
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
                  onClick={confirmingDelete ? handleDelete : withHaptic(() => setConfirmingDelete(true))}
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

    {datePickerOpen && (
      <DateTimePickerSheet
        initial={customDate}
        onClose={() => setDatePickerOpen(false)}
        onApply={(picked) => {
          setCustomDate(picked);
          setDateChanged(true);
          setDatePickerOpen(false);
        }}
      />
    )}
    </>
  );
}
