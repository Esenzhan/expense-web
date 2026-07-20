import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchInsights } from "../api";
import { getCategoryIcon } from "../categoryIcons";
import { getWalletIcon } from "../wallets";
import InsightsChart from "./InsightsChart";
import { useSwipeDismiss } from "../sheetGestures";

const PERIOD_LABELS = { month: "Этот месяц", 7: "7 дней", 30: "30 дней" };

function tenge(value) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

// Monthly spending limit, kept on the client per wallet («all» = все счета)
function limitKey(wallet) {
  return `monthlyLimit:${wallet || "all"}`;
}

function readLimit(wallet) {
  const raw = Number(localStorage.getItem(limitKey(wallet)));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function daysInCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

export default function InsightsSheet({ period, wallet, walletBalance, onClose }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState(() => readLimit(wallet));
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState("");

  useEffect(() => {
    setMonthlyLimit(readLimit(wallet));
    setEditingLimit(false);
  }, [wallet]);

  function saveLimit() {
    const value = Number(limitDraft.replace(/[^\d]/g, ""));
    if (value > 0) localStorage.setItem(limitKey(wallet), String(value));
    else localStorage.removeItem(limitKey(wallet));
    setMonthlyLimit(value > 0 ? value : 0);
    setEditingLimit(false);
  }

  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchInsights(period, wallet)
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
  }, [period, wallet]);

  const biggestIcon = data?.biggestExpense ? getCategoryIcon(data.biggestExpense.category) : null;

  // Портал в body: шторка рендерится внутри .app, который при открытии
  // получает transform (scale) — transform делает предка containing block
  // для position:fixed, и затемнение сжималось вместе с экраном
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="insights-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="insights-header">
          <div className="wallet-chip">
            <span
              className="wallet-chip-icon"
              style={wallet ? { background: getWalletIcon(wallet).bg, color: getWalletIcon(wallet).fg } : undefined}
            >
              {wallet ? getWalletIcon(wallet).emoji : "💳"}
            </span>
            <div>
              <div className="wallet-chip-name">{wallet || "Все счета"}</div>
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
              plannedTotal={
                period === "month"
                  ? monthlyLimit
                  : (monthlyLimit / daysInCurrentMonth()) * data.daysInPeriod
              }
            />

            {editingLimit ? (
              <div className="limit-editor">
                <input
                  className="limit-input"
                  type="text"
                  inputMode="numeric"
                  autoFocus
                  placeholder="Лимит на месяц, ₸"
                  value={limitDraft}
                  onChange={(event) => setLimitDraft(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && saveLimit()}
                />
                <button className="limit-save" onClick={saveLimit}>
                  ОК
                </button>
              </div>
            ) : (
              <button
                className="limit-pill"
                onClick={() => {
                  setLimitDraft(monthlyLimit ? String(monthlyLimit) : "");
                  setEditingLimit(true);
                }}
              >
                {monthlyLimit ? `Лимит на месяц: ${tenge(monthlyLimit)} ✎` : "✎ Задать лимит на месяц"}
              </button>
            )}

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
    </div>,
    document.body
  );
}
