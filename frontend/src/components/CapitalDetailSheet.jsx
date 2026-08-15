import { useEffect, useRef, useState } from "react";
import { fetchCapitalSnapshot, deleteCapitalSnapshot } from "../api";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { almaty } from "../insights";

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU")} ₸`;
}

function formatDate(iso) {
  const shifted = almaty(new Date(iso));
  return shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

// Открывается тапом по строке в CapitalSheet — полный разбор одного снимка
// (какие именно активы/обязательства в него вошли) плюс удаление, если
// снимок занесли по ошибке.
export default function CapitalDetailSheet({ snapshot, previousTotal, onClose, onDeleted }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    fetchCapitalSnapshot(snapshot.id)
      .then(setDetail)
      .catch(() => setError("Не удалось загрузить снимок"))
      .finally(() => setLoading(false));
  }, [snapshot.id]);

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

  const assets = detail?.items.filter((item) => item.kind === "asset") || [];
  const liabilities = detail?.items.filter((item) => item.kind === "liability") || [];
  const growth = previousTotal != null ? Number(snapshot.total) - Number(previousTotal) : null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">{formatDate(snapshot.created_at)}</span>
          <span className="icon-button-spacer" />
        </div>

        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-row-label">Итого</span>
            <span className="settings-row-value">{formatAmount(snapshot.total)}</span>
          </div>
          {growth != null && (
            <div className="settings-row">
              <span className="settings-row-label">Прирост</span>
              <span className={`settings-row-value capital-growth ${growth >= 0 ? "up" : "down"}`}>
                {growth >= 0 ? "+" : "−"}
                {formatAmount(Math.abs(growth))}
              </span>
            </div>
          )}
          {snapshot.created_by_name && (
            <div className="settings-row">
              <span className="settings-row-label">Посчитал(а)</span>
              <span className="settings-row-value">{snapshot.created_by_name}</span>
            </div>
          )}
        </div>

        {loading && <p className="empty-hint">Загрузка…</p>}
        {error && <p className="reminder-hint reminder-hint-error">{error}</p>}

        {!loading && assets.length > 0 && (
          <>
            <p className="newcat-group-title">Активы</p>
            <div className="settings-group">
              {assets.map((item) => (
                <div className="settings-row" key={item.id}>
                  <span className="settings-row-label">{item.name}</span>
                  <span className="settings-row-value">{formatAmount(item.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && liabilities.length > 0 && (
          <>
            <p className="newcat-group-title">Обязательства</p>
            <div className="settings-group">
              {liabilities.map((item) => (
                <div className="settings-row" key={item.id}>
                  <span className="settings-row-label">{item.name}</span>
                  <span className="settings-row-value">{formatAmount(item.amount)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <button className="sheet-delete" onClick={handleDelete} disabled={saving}>
          {confirmingDelete ? "Точно удалить снимок?" : "Удалить снимок"}
        </button>
      </div>
    </div>
  );
}
