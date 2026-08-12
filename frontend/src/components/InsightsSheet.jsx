import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCategoryIcon, listCategories } from "../categoryIcons";
import { getWalletIcon } from "../wallets";
import { fetchCategoryLimits, setCategoryLimit, deleteCategoryLimit } from "../api";
import CategoryGlyph from "./CategoryGlyph";
import InsightsChart from "./InsightsChart";
import { useSwipeDismiss } from "../sheetGestures";
import { formatPeriodLabel } from "../insights";

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

export default function InsightsSheet({ period, insights: data, wallet, walletBalance, onClose }) {
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

  // Per-category limits — unlike the overall monthly limit above, these live
  // on the server (shared wallets need the same limit on both accounts, see
  // /api/category-limits), fetched fresh whenever the wallet changes.
  const [categoryLimits, setCategoryLimits] = useState({});
  const [categoryLimitsReady, setCategoryLimitsReady] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryLimitDraft, setCategoryLimitDraft] = useState("");
  const [categoryLimitError, setCategoryLimitError] = useState(null);

  useEffect(() => {
    setEditingCategory(null);
    setCategoryLimitError(null);
    if (!wallet) {
      setCategoryLimits({});
      setCategoryLimitsReady(false);
      return;
    }
    setCategoryLimitsReady(false);
    fetchCategoryLimits(wallet)
      .then((rows) => {
        const map = {};
        for (const row of rows) map[row.category] = Number(row.monthly_limit);
        setCategoryLimits(map);
      })
      .catch(() => setCategoryLimits({}))
      .finally(() => setCategoryLimitsReady(true));
  }, [wallet]);

  function saveCategoryLimit(category) {
    const value = Number(categoryLimitDraft.replace(/[^\d]/g, ""));
    setCategoryLimitError(null);
    const request = value > 0
      ? setCategoryLimit(wallet, category, value)
      : deleteCategoryLimit(wallet, category);
    request
      .then(() => {
        setCategoryLimits((current) => {
          const next = { ...current };
          if (value > 0) next[category] = value;
          else delete next[category];
          return next;
        });
        setEditingCategory(null);
      })
      .catch((err) => setCategoryLimitError(err.message || "Не удалось сохранить лимит"));
  }

  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  // `data` (aliased from the `insights` prop) is computed by App.jsx in the
  // background — already fresh by the time this sheet opens, no fetch here.
  const biggestIcon = data?.biggestExpense
    ? getCategoryIcon(data.biggestExpense.wallet, data.biggestExpense.category)
    : null;

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

        {!data && <div className="sheet-spinner" />}

        {data && (
          <>
            <div className="insights-period-pill">{formatPeriodLabel(period)}</div>
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
                    <span className="insights-card-icon-badge" style={{ background: "#fff", color: biggestIcon.fg }}>
                      <CategoryGlyph emoji={biggestIcon.emoji} size={20} />
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

            {wallet && period === "month" && (
              <div className="category-limits-section">
                <p className="section-title">Лимиты по категориям</p>
                {categoryLimitError && <p className="sheet-error">{categoryLimitError}</p>}
                {!categoryLimitsReady && <div className="sheet-spinner" />}
                {categoryLimitsReady &&
                  listCategories(wallet).map((cat) => {
                    const limit = categoryLimits[cat.name] || 0;
                    const spent = data.categoryTotals[cat.name] || 0;
                    const isEditing = editingCategory === cat.name;
                    return (
                      <div className="category-limit-row" key={cat.name}>
                        {isEditing ? (
                          <div className="limit-editor category-limit-editor">
                            <input
                              className="limit-input"
                              type="text"
                              inputMode="numeric"
                              autoFocus
                              placeholder="Лимит, ₸"
                              value={categoryLimitDraft}
                              onChange={(event) => setCategoryLimitDraft(event.target.value)}
                              onKeyDown={(event) => event.key === "Enter" && saveCategoryLimit(cat.name)}
                            />
                            <button className="limit-save" onClick={() => saveCategoryLimit(cat.name)}>
                              ОК
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Отмена"
                              onClick={() => setEditingCategory(null)}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            className="category-limit-body"
                            onClick={() => {
                              setEditingCategory(cat.name);
                              setCategoryLimitDraft(limit ? String(limit) : "");
                            }}
                          >
                            <span className="category-icon" style={{ background: cat.bg, color: cat.fg }}>
                              <CategoryGlyph emoji={cat.emoji} size={18} />
                            </span>
                            <span className="category-limit-text">
                              <span className="category-limit-head">
                                <span className="category-limit-name">{cat.name}</span>
                                <span className="category-limit-amounts">
                                  {limit ? `${tenge(spent)} / ${tenge(limit)}` : "Лимит не задан"}
                                </span>
                              </span>
                              {limit > 0 && (
                                <span className="category-limit-bar-track">
                                  <span
                                    className={`category-limit-bar-fill ${spent > limit ? "over" : ""}`}
                                    style={{ width: `${Math.min(100, (spent / limit) * 100)}%` }}
                                  />
                                </span>
                              )}
                            </span>
                          </button>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
