import { useEffect, useRef, useState } from "react";
import { withHaptic, haptic } from "../haptics";
import { createPortal } from "react-dom";
import { getCategoryIcon, listCategories } from "../categoryIcons";
import { getWalletIcon, walletCurrency } from "../wallets";
import { currencySymbol, formatMoney } from "../currencies";
import { fetchCategoryLimits, setCategoryLimit, deleteCategoryLimit } from "../api";
import CategoryGlyph from "./CategoryGlyph";
import InsightsChart from "./InsightsChart";
import { catIconVars } from "../catIconVars";
import { useSwipeDismiss } from "../sheetGestures";
import { formatPeriodLabel } from "../insights";
import { loadCached, saveCached } from "../offlineCache";

function categoryLimitsCacheKey(wallet) {
  return `traty-category-limits-${wallet}`;
}

// Валюта здесь — валюта выбранного счёта; «Все счета» считаются в тенге
// (валютные счета в общий итог и так не входят, см. wallets.isHomeWallet).
function money(value, code) {
  return formatMoney(Math.round(value), code);
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

export default function InsightsSheet({ user, period, insights: data, wallet, walletBalance, onClose }) {
  const currency = walletCurrency(wallet);
  const fmt = (value) => money(value, currency);
  const email = user?.email;
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
  // Discards an out-of-order response — same guard as SearchSheet.jsx —
  // so a slower fetch for a wallet since switched away from can't land
  // after and overwrite the currently-displayed wallet's limits.
  const limitsRequestIdRef = useRef(0);

  useEffect(() => {
    setEditingCategory(null);
    setCategoryLimitError(null);
    if (!wallet) {
      setCategoryLimits({});
      setCategoryLimitsReady(false);
      return;
    }
    const requestId = ++limitsRequestIdRef.current;
    const cached = loadCached(categoryLimitsCacheKey(wallet), email);
    setCategoryLimits(cached || {});
    setCategoryLimitsReady(!!cached);
    fetchCategoryLimits(wallet)
      .then((rows) => {
        if (limitsRequestIdRef.current !== requestId) return;
        const map = {};
        for (const row of rows) map[row.category] = Number(row.monthly_limit);
        setCategoryLimits(map);
        if (email) saveCached(categoryLimitsCacheKey(wallet), email, map);
      })
      .catch(() => {
        // Offline or the request failed — if this wallet's limits were
        // already cached (hydrated above), leave those showing instead of
        // wiping them back to "no limits set".
      })
      .finally(() => {
        if (limitsRequestIdRef.current === requestId) setCategoryLimitsReady(true);
      });
  }, [wallet, email]);

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
          if (email) saveCached(categoryLimitsCacheKey(wallet), email, next);
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
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="insights-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="insights-header">
          <div className="wallet-chip">
            <span
              className="wallet-chip-icon"
              style={wallet ? catIconVars(getWalletIcon(wallet).bg, getWalletIcon(wallet).fg) : undefined}
            >
              <CategoryGlyph emoji={wallet ? getWalletIcon(wallet).emoji : "💳"} size={20} />
            </span>
            <div>
              <div className="wallet-chip-name">{wallet || "Все счета"}</div>
              <div className="wallet-chip-balance">−{formatMoney(walletBalance, currency)}</div>
            </div>
          </div>
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть">
            ✕
          </button>
        </div>

        {!data && <div className="sheet-spinner" />}

        {data && (
          <>
            <div className="insights-period-pill">{formatPeriodLabel(period)}</div>
            <div className="insights-total">−{fmt(data.total)}</div>

            <InsightsChart
              series={data.series}
              daysInPeriod={data.daysInPeriod}
              todayIndex={data.todayIndex}
              total={data.total}
              currency={currency}
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
                  placeholder={`Лимит на месяц, ${currencySymbol(currency)}`}
                  value={limitDraft}
                  onChange={(event) => setLimitDraft(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && saveLimit()}
                />
                <button className="limit-save" onClick={withHaptic(saveLimit)}>
                  ОК
                </button>
              </div>
            ) : (
              <button
                className="limit-pill"
                onClick={() => {
                  haptic();
                  setLimitDraft(monthlyLimit ? String(monthlyLimit) : "");
                  setEditingLimit(true);
                }}
              >
                {monthlyLimit ? `Лимит на месяц: ${fmt(monthlyLimit)} ✎` : "✎ Задать лимит на месяц"}
              </button>
            )}

            <div className="insights-grid">
              <div className="insights-card">
                <div className="insights-card-head">
                  <span className="insights-card-title">Средние траты в день</span>
                  <span className="insights-card-icon">📅</span>
                </div>
                <div className="insights-card-value">{formatMoney(Number(data.avgPerDay.toFixed(2)), currency)}</div>
              </div>

              <div
                className="insights-card"
                style={
                  biggestIcon
                    ? {
                        background: `linear-gradient(135deg, color-mix(in srgb, ${biggestIcon.fg} 22%, var(--surface-soft)), var(--surface-soft))`,
                      }
                    : undefined
                }
              >
                <div className="insights-card-head">
                  <span className="insights-card-title">Самая большая трата</span>
                </div>
                {data.biggestExpense ? (
                  <>
                    <span className="insights-card-icon-badge" style={catIconVars("#fff", biggestIcon.fg)}>
                      <CategoryGlyph emoji={biggestIcon.emoji} size={20} />
                    </span>
                    <div className="insights-card-sub">{data.biggestExpense.category}</div>
                    <div className="insights-card-value accent">{fmt(data.biggestExpense.amount)}</div>
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
                    <div className="insights-card-value">{fmt(data.mostExpensiveDay.amount)}</div>
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
                {categoryLimitsReady && (() => {
                  const totalLimit = Object.values(categoryLimits).reduce((sum, v) => sum + v, 0);
                  const totalSpent = data.total;
                  const walletIcon = getWalletIcon(wallet);
                  return (
                    <div className="category-limit-row">
                      <div className="category-limit-body total">
                        <span className="category-icon" style={catIconVars(walletIcon.bg, walletIcon.fg)}>
                          <CategoryGlyph emoji={walletIcon.emoji} size={20} />
                        </span>
                        <span className="category-limit-text">
                          <span className="category-limit-head">
                            <span className="category-limit-name">Весь кошелёк</span>
                            <span className="category-limit-amounts">
                              {totalLimit ? `${fmt(totalSpent)} / ${fmt(totalLimit)}` : fmt(totalSpent)}
                            </span>
                          </span>
                          {totalLimit > 0 && (
                            <span className="category-limit-bar-track">
                              <span
                                className={`category-limit-bar-fill ${totalSpent > totalLimit ? "over" : ""}`}
                                style={{ width: `${Math.min(100, (totalSpent / totalLimit) * 100)}%` }}
                              />
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })()}
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
                              placeholder={`Лимит, ${currencySymbol(currency)}`}
                              value={categoryLimitDraft}
                              onChange={(event) => setCategoryLimitDraft(event.target.value)}
                              onKeyDown={(event) => event.key === "Enter" && saveCategoryLimit(cat.name)}
                            />
                            <button className="limit-save" onClick={() => withHaptic(saveCategoryLimit)(cat.name)}>
                              ОК
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Отмена"
                              onClick={withHaptic(() => setEditingCategory(null))}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <button
                            className="category-limit-body"
                            onClick={() => {
                              haptic();
                              setEditingCategory(cat.name);
                              setCategoryLimitDraft(limit ? String(limit) : "");
                            }}
                          >
                            <span className="category-icon" style={catIconVars(cat.bg, cat.fg)}>
                              <CategoryGlyph emoji={cat.emoji} size={18} />
                            </span>
                            <span className="category-limit-text">
                              <span className="category-limit-head">
                                <span className="category-limit-name">{cat.name}</span>
                                <span className="category-limit-amounts">
                                  {limit ? `${fmt(spent)} / ${fmt(limit)}` : "Лимит не задан"}
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
