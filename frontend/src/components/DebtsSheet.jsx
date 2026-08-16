import { useEffect, useRef, useState } from "react";
import { fetchDebts } from "../api";
import { haptic } from "../haptics";
import { useSwipeDismissRight } from "../sheetGestures";
import { avatarColorFor, avatarInitial, formatDueDate, overdueDays, formatOverdue } from "../debtDisplay";
import { catIconVars } from "../catIconVars";

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`;
}

function pluralPeople(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "человек";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "человека";
  return "человек";
}

// «Долги» (Настройки-стиль полноэкранная страница, открывается с иконки
// «Статистика» в шапке — см. App.jsx): нам должны / мы должны, каждое —
// личное или семейное (та же приватность, что у кошельков). Выдача и
// погашение могут опционально двигать баланс конкретного счёта (см.
// NewDebtSheet/DebtDetailSheet) — сюда сайт только читает уже посчитанный
// список, вся логика подсчёта на бэкенде (routes/debts.js).
export default function DebtsSheet({ onClose, onOpenNewDebt, onOpenDebt, refreshKey }) {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [direction, setDirection] = useState("owed_to_us");
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
    fetchDebts()
      .then(setDebts)
      .catch(() => setError("Не удалось загрузить долги"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [refreshKey]);

  const filtered = debts.filter((d) => d.direction === direction);
  const openDebts = filtered.filter((d) => d.status === "open");
  const openTotal = openDebts.reduce((sum, d) => sum + Number(d.remaining), 0);
  const overdueCount = openDebts.filter((d) => overdueDays(d) != null).length;

  return (
    <div ref={pageRef} className="settings-page">
      <div className="settings-header">
        <button className="icon-button" onClick={handleClose} aria-label="Назад">
          ‹
        </button>
        <span className="settings-title">Долги</span>
        <button
          className="icon-button"
          onClick={() => {
            haptic();
            onOpenNewDebt();
          }}
          aria-label="Новый долг"
        >
          +
        </button>
      </div>

      <div className="debt-direction-toggle">
        <button
          className={`period-pill ${direction === "owed_to_us" ? "active" : ""}`}
          onClick={() => {
            haptic();
            setDirection("owed_to_us");
          }}
        >
          Мне должны
        </button>
        <button
          className={`period-pill ${direction === "we_owe" ? "active" : ""}`}
          onClick={() => {
            haptic();
            setDirection("we_owe");
          }}
        >
          Я должен
        </button>
      </div>

      {!loading && !error && filtered.length > 0 && (
        <>
          <p className="hero-total-label">
            {direction === "owed_to_us" ? "Мне должны" : "Я должен"} · открыто
          </p>
          <div className="hero-total-row">
            <span className="hero-total">{formatAmount(openTotal)}</span>
            {overdueCount > 0 && (
              <span className="debt-overdue-chip">
                {overdueCount} из {openDebts.length} просрочен{overdueCount === 1 ? "" : "ы"}
              </span>
            )}
          </div>
          <p className="hero-total-sub">
            {filtered.length} {pluralPeople(filtered.length)}
          </p>
        </>
      )}

      {loading && <p className="empty-hint">Загрузка…</p>}
      {error && <p className="reminder-hint reminder-hint-error">{error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="empty-hint">Пока пусто — нажмите «+», чтобы добавить долг.</p>
      )}

      {!loading && filtered.length > 0 && (
        <div className="settings-group">
          {filtered.map((debt) => {
            const overdue = overdueDays(debt);
            const color = avatarColorFor(debt.counterparty);
            const sub = overdue
              ? formatOverdue(overdue)
              : debt.description
                ? debt.description
                : debt.due_date
                  ? `Вернуть до ${formatDueDate(debt.due_date)}`
                  : null;
            return (
              <button
                key={debt.id}
                className={`settings-row debt-row ${debt.status === "closed" ? "debt-row-closed" : ""} ${overdue ? "debt-row-overdue" : ""}`}
                onClick={() => {
                  haptic();
                  onOpenDebt(debt);
                }}
              >
                <span className="debt-avatar" style={catIconVars(color.bg, color.fg)}>
                  {avatarInitial(debt.counterparty)}
                </span>
                <span className="debt-row-main">
                  <span className="debt-row-title">
                    {debt.counterparty}
                    <span className="debt-row-scope">
                      {debt.user_id == null ? "Семейный" : "Личный"}
                    </span>
                  </span>
                  {sub && <span className={`debt-row-sub ${overdue ? "debt-row-sub-overdue" : ""}`}>{sub}</span>}
                </span>
                <span className={`debt-row-amount ${overdue ? "debt-row-amount-overdue" : ""}`}>
                  {debt.status === "closed" ? "Погашено" : formatAmount(debt.remaining)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
