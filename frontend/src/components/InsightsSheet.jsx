import { useEffect, useRef, useState } from "react";
import { fetchInsights } from "../api";
import { getCategoryIcon } from "../categoryIcons";
import InsightsChart from "./InsightsChart";
import { useBodyScrollLock, useSwipeDismiss } from "../sheetGestures";

const PERIOD_LABELS = { month: "Этот месяц", 7: "7 дней", 30: "30 дней" };

function tenge(value) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

export default function InsightsSheet({ period, walletBalance, onClose }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const sheetRef = useRef(null);
  useBodyScrollLock();
  useSwipeDismiss(sheetRef, onClose);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInsights(period)
      .then((result) => {
        if (cancelled) return;
        if (result.error) setError(result.error);
        else setData(result);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period]);

  const biggestIcon = data?.biggestExpense ? getCategoryIcon(data.biggestExpense.category) : null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="insights-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="insights-header">
          <div className="wallet-chip">
            <span className="wallet-chip-icon">💳</span>
            <div>
              <div className="wallet-chip-name">Кошелёк</div>
              <div className="wallet-chip-balance">−{walletBalance.toLocaleString("ru-RU")} ₸</div>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        {loading && <div className="sheet-spinner" />}
        {!loading && error && <p className="sheet-error">{error}</p>}

        {!loading && !error && data && (
          <>
            <div className="insights-period-pill">{PERIOD_LABELS[period] || PERIOD_LABELS.month}</div>
            <div className="insights-total">−{tenge(data.total)}</div>

            <InsightsChart
              series={data.series}
              daysInPeriod={data.daysInPeriod}
              todayIndex={data.todayIndex}
              total={data.total}
              previousPeriodTotal={data.previousPeriodTotal}
            />

            <div className="insights-grid">
              <div className="insights-card">
                <div className="insights-card-head">
                  <span className="insights-card-title">Средние траты в день</span>
                  <span className="insights-card-icon">📅</span>
                </div>
                <div className="insights-card-value">{data.avgPerDay.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸</div>
              </div>

              <div
                className="insights-card"
                style={
                  biggestIcon
                    ? { background: `linear-gradient(135deg, ${biggestIcon.bg}, var(--surface-soft))` }
                    : undefined
                }
              >
                <div className="insights-card-head">
                  <span className="insights-card-title">Самая большая трата</span>
                </div>
                {data.biggestExpense ? (
                  <>
                    <span className="insights-card-icon-badge" style={{ background: "#fff" }}>
                      {biggestIcon.emoji}
                    </span>
                    <div className="insights-card-sub">{data.biggestExpense.category}</div>
                    <div className="insights-card-value accent">{tenge(data.biggestExpense.amount)}</div>
                  </>
                ) : (
                  <div className="insights-card-sub">Нет данных</div>
                )}
              </div>

              <div className="insights-card">
                <div className="insights-card-head">
                  <span className="insights-card-title">Самый дорогой день</span>
                  <span className="insights-card-icon">👜</span>
                </div>
                {data.mostExpensiveDay ? (
                  <>
                    <div className="insights-card-sub">{data.mostExpensiveDay.label}</div>
                    <div className="insights-card-value">{tenge(data.mostExpensiveDay.amount)}</div>
                  </>
                ) : (
                  <div className="insights-card-sub">Нет данных</div>
                )}
              </div>

              <div className="insights-card">
                <div className="insights-card-head">
                  <span className="insights-card-title">Серия без трат</span>
                  <span className="insights-card-icon">🔥</span>
                </div>
                {data.noSpendStreak ? (
                  <>
                    <div className="insights-card-sub">
                      {data.noSpendStreak.fromLabel} – {data.noSpendStreak.toLabel}
                    </div>
                    <div className="insights-card-value">{data.noSpendStreak.days}</div>
                  </>
                ) : (
                  <div className="insights-card-sub">Пока нет серии</div>
                )}
              </div>

              <div className="insights-card">
                <div className="insights-card-head">
                  <span className="insights-card-title">Траты в выходные</span>
                  <span className="insights-card-icon">🏖️</span>
                </div>
                <div className="insights-card-sub">{data.weekendPercent}% трат приходится на выходные</div>
                <div className="insights-card-value">{data.weekendPercent}%</div>
              </div>

              <div className="insights-card">
                <div className="insights-card-head">
                  <span className="insights-card-title">Количество операций</span>
                </div>
                <div className="insights-card-sub">Операций за выбранный период</div>
                <div className="insights-card-value">{data.transactionCount}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
