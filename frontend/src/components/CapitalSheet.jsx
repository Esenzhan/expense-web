import { useEffect, useRef, useState } from "react";
import { fetchCapitalSnapshots } from "../api";
import { haptic } from "../haptics";
import { useSwipeDismissRight } from "../sheetGestures";
import { almaty } from "../insights";
import CapitalChart from "./CapitalChart";

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

const RANGE_MONTHS = { "6": 6, "12": 12 };

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
  const [range, setRange] = useState("all");
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
  const previous = snapshots[1];
  const growth = latest && previous ? Number(latest.total) - Number(previous.total) : null;

  const assetsTotal = latest ? Number(latest.assets_total) : 0;
  const liabilitiesTotal = latest ? Number(latest.liabilities_total) : 0;
  const compositionTotal = assetsTotal + liabilitiesTotal;
  const assetsShare = compositionTotal > 0 ? Math.round((assetsTotal / compositionTotal) * 100) : 100;

  // Range pills scope the chart only — the history list below always shows
  // everything, this is just "how far back to plot".
  let chartSnapshots = snapshots;
  if (range !== "all") {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RANGE_MONTHS[range]);
    chartSnapshots = snapshots.filter((s) => new Date(s.created_at) >= cutoff);
  }
  const chartPoints = [...chartSnapshots].reverse().map((s) => ({ created_at: s.created_at, total: Number(s.total) }));

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

      {loading && <p className="empty-hint">Загрузка…</p>}
      {error && <p className="reminder-hint reminder-hint-error">{error}</p>}
      {!loading && !error && snapshots.length === 0 && (
        <p className="empty-hint">Пока пусто — нажмите «+», чтобы посчитать капитал.</p>
      )}

      {!loading && !error && latest && (
        <>
          <p className="hero-total-label">Сейчас</p>
          <div className="hero-total-row">
            <span className="hero-total">{formatAmount(latest.total)}</span>
            {growth != null && (
              <span className={`growth-chip ${growth >= 0 ? "up" : "down"}`}>{formatGrowth(growth)}</span>
            )}
          </div>

          <div className="stat-tiles">
            <div className="stat-tile assets">
              <div className="stat-tile-label">Активы</div>
              <div className="stat-tile-value">{formatAmount(assetsTotal)}</div>
            </div>
            <div className="stat-tile liabilities">
              <div className="stat-tile-label">Обязательства</div>
              <div className="stat-tile-value">{formatAmount(liabilitiesTotal)}</div>
            </div>
          </div>

          {compositionTotal > 0 && (
            <>
              <div className="comp-bar">
                <div className="comp-bar-assets" style={{ width: `${assetsShare}%` }} />
                <div className="comp-bar-liabilities" style={{ width: `${100 - assetsShare}%` }} />
              </div>
              <div className="comp-legend">
                <span>
                  <b>{assetsShare}%</b> активы
                </span>
                <span>
                  <b>{100 - assetsShare}%</b> обязательства
                </span>
              </div>
            </>
          )}

          {chartPoints.length > 1 && (
            <>
              <div className="range-pills">
                <button
                  className={`range-pill ${range === "6" ? "active" : ""}`}
                  onClick={() => {
                    haptic();
                    setRange("6");
                  }}
                >
                  6М
                </button>
                <button
                  className={`range-pill ${range === "12" ? "active" : ""}`}
                  onClick={() => {
                    haptic();
                    setRange("12");
                  }}
                >
                  Год
                </button>
                <button
                  className={`range-pill ${range === "all" ? "active" : ""}`}
                  onClick={() => {
                    haptic();
                    setRange("all");
                  }}
                >
                  Всё время
                </button>
              </div>
              <CapitalChart points={chartPoints} />
            </>
          )}

          <p className="section-label">История</p>
        </>
      )}

      {!loading && snapshots.length > 0 && (
        <div className="settings-group">
          {snapshots.map((snapshot, index) => {
            const prev = snapshots[index + 1];
            const rowGrowth = prev ? Number(snapshot.total) - Number(prev.total) : null;
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
                  {rowGrowth != null && (
                    <span className={`capital-growth ${rowGrowth >= 0 ? "up" : "down"}`}>
                      {formatGrowth(rowGrowth)}
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
