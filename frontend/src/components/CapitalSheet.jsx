import { useEffect, useRef, useState } from "react";
import { fetchCapitalSnapshots } from "../api";
import { haptic } from "../haptics";
import { useSwipeDismissRight } from "../sheetGestures";
import { almaty } from "../insights";

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU")} ₸`;
}

function formatGrowth(amount) {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${Number(Math.abs(amount)).toLocaleString("ru-RU")} ₸`;
}

function formatDate(iso) {
  const shifted = almaty(new Date(iso));
  return shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

// «Капитал» (Настройки-стиль полноэкранная страница, как «Долги») — снимки
// общего капитала семьи, которые считают раз в месяц-два: сумма активов
// минус обязательства на конкретный момент. Прирост каждой строки — просто
// разница с предыдущим по времени снимком (список уже отсортирован по
// created_at DESC на бэкенде, так что это сосед по индексу).
export default function CapitalSheet({ onClose, onOpenNew, onOpenSnapshot, refreshKey }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [closing, setClosing] = useState(false);
  const pageRef = useRef(null);

  useSwipeDismissRight(pageRef, onClose);

  function handleClose() {
    if (closing) return;
    haptic();
    setClosing(true);
    const el = pageRef.current;
    if (el) {
      el.style.transition = "transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)";
      el.style.transform = "translateX(100%)";
    }
    setTimeout(onClose, 260);
  }

  function load() {
    setLoading(true);
    fetchCapitalSnapshots()
      .then(setSnapshots)
      .catch(() => setError("Не удалось загрузить капитал"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [refreshKey]);

  const latest = snapshots[0];

  return (
    <div ref={pageRef} className="settings-page">
      <div className="settings-header">
        <button className="icon-button" onClick={handleClose} aria-label="Назад">
          ‹
        </button>
        <span className="settings-title">Капитал</span>
        <button
          className="icon-button"
          onClick={() => {
            haptic();
            onOpenNew();
          }}
          aria-label="Новый снимок"
        >
          +
        </button>
      </div>

      {!loading && !error && latest && (
        <p className="debt-total">
          Сейчас: <strong>{formatAmount(latest.total)}</strong>
        </p>
      )}

      {loading && <p className="empty-hint">Загрузка…</p>}
      {error && <p className="reminder-hint reminder-hint-error">{error}</p>}
      {!loading && !error && snapshots.length === 0 && (
        <p className="empty-hint">Пока пусто — нажмите «+», чтобы посчитать капитал.</p>
      )}

      {!loading && snapshots.length > 0 && (
        <div className="settings-group">
          {snapshots.map((snapshot, index) => {
            const prev = snapshots[index + 1];
            const growth = prev ? Number(snapshot.total) - Number(prev.total) : null;
            return (
              <button
                key={snapshot.id}
                className="settings-row debt-row"
                onClick={() => {
                  haptic();
                  onOpenSnapshot(snapshot, prev ? prev.total : null);
                }}
              >
                <span className="debt-row-main">
                  <span className="debt-row-title">{formatDate(snapshot.created_at)}</span>
                  {growth != null && (
                    <span className={`capital-growth ${growth >= 0 ? "up" : "down"}`}>
                      {formatGrowth(growth)}
                    </span>
                  )}
                </span>
                <span className="debt-row-amount">{formatAmount(snapshot.total)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
