import { useEffect, useRef, useState } from "react";
import { fetchDebtPayments, payDebt, deleteDebt } from "../api";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { almaty } from "../insights";

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`;
}

function formatWhen(iso) {
  const shifted = almaty(new Date(iso));
  const date = shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" });
  const time = shifted.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time}`;
}

// created_at is a full timestamp, due_date a plain YYYY-MM-DD — both just
// need the calendar date here, no time-of-day.
function formatDate(value) {
  const shifted = almaty(new Date(value));
  return shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

// Открывается тапом по строке в DebtsSheet — детали долга, история платежей
// и форма погашения (полного или частичного). Удаление доступно только пока
// не было ни одного платежа (см. routes/debts.js — иначе пришлось бы
// откатывать историю баланса по каждому платежу).
export default function DebtDetailSheet({ debt: initialDebt, currentUserId, onClose, onChanged }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [debt, setDebt] = useState(initialDebt);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [payAmount, setPayAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    fetchDebtPayments(debt.id)
      .then(setPayments)
      .catch(() => {})
      .finally(() => setLoadingPayments(false));
  }, [debt.id]);

  async function handlePay() {
    const num = Number(payAmount.replace(",", "."));
    if (!Number.isFinite(num) || num <= 0) {
      setError("Введите сумму больше нуля");
      return;
    }
    if (num > Number(debt.remaining)) {
      setError("Сумма больше остатка долга");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updated = await payDebt(debt.id, num);
      hapticHeavy();
      setDebt(updated);
      setPayAmount("");
      const freshPayments = await fetchDebtPayments(debt.id);
      setPayments(freshPayments);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
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
      await deleteDebt(debt.id);
      hapticHeavy();
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
      setConfirmingDelete(false);
    }
  }

  const canDelete = Number(debt.remaining) === Number(debt.amount);
  // Family-scoped debts are visible to both accounts, but only whoever
  // created it can settle it (see routes/debts.js's POST /:id/payments) —
  // otherwise its wallet re-basing would end up tied to the wrong account.
  const canPay = debt.created_by === currentUserId;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">{debt.counterparty}</span>
          <span className="icon-button-spacer" />
        </div>

        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-row-label">Направление</span>
            <span className="settings-row-value">
              {debt.direction === "owed_to_us" ? "Мне должны" : "Я должен"}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Тип</span>
            <span className="settings-row-value">{debt.user_id == null ? "Семейный" : "Личный"}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Изначально</span>
            <span className="settings-row-value">{formatAmount(debt.amount)}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Дата выдачи</span>
            <span className="settings-row-value">{formatDate(debt.created_at)}</span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Осталось</span>
            <span className="settings-row-value">
              {debt.status === "closed" ? "Погашено" : formatAmount(debt.remaining)}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Дата погашения</span>
            <span className="settings-row-value">
              {debt.due_date ? formatDate(debt.due_date) : "Не указана"}
            </span>
          </div>
          {debt.description && (
            <div className="settings-row">
              <span className="settings-row-label">Комментарий</span>
              <span className="settings-row-value">{debt.description}</span>
            </div>
          )}
        </div>

        {!loadingPayments && payments.length > 0 && (
          <>
            <p className="newcat-group-title">Платежи</p>
            <div className="settings-group">
              {payments.map((p) => (
                <div className="settings-row balance-history-row" key={p.id}>
                  <span className="debt-row-main">
                    <span className="balance-history-sub">
                      {formatAmount(p.amount)}
                      {p.wallet ? ` · ${p.wallet}` : ""}
                      {p.changed_by_name ? ` · ${p.changed_by_name}` : ""}
                    </span>
                  </span>
                  <span className="balance-history-when">{formatWhen(p.created_at)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {debt.status === "open" && canPay && (
          <>
            <p className="newcat-group-title">Погасить</p>
            <div className="balance-row">
              <span className="balance-label">Сумма</span>
              <input
                className="balance-input"
                type="number"
                inputMode="decimal"
                placeholder={Number(debt.remaining).toFixed(2)}
                value={payAmount}
                onChange={(event) => {
                  setPayAmount(event.target.value);
                  setError("");
                }}
              />
            </div>
            <button
              type="button"
              className="debt-quick-fill"
              onClick={() => {
                haptic();
                setPayAmount(String(Number(debt.remaining)));
              }}
            >
              Погасить полностью
            </button>

            <p className="debt-hint">
              {debt.wallet
                ? debt.direction === "owed_to_us"
                  ? `Сумма зачислится на баланс «${debt.wallet}» — счёт, выбранный при создании долга.`
                  : `Сумма спишется с баланса «${debt.wallet}» — счёт, выбранный при создании долга.`
                : "Долг создан без привязки к счёту — баланс не изменится."}
            </p>

            {error && <p className="sheet-error">{error}</p>}

            <button className="sheet-close" onClick={handlePay} disabled={saving}>
              {saving ? "Сохраняю…" : "Погасить"}
            </button>
          </>
        )}

        {debt.status === "open" && !canPay && (
          <p className="debt-hint">Погасить может только тот, кто создал этот долг.</p>
        )}

        {canDelete && (
          <button className="sheet-delete" onClick={handleDelete} disabled={saving}>
            {confirmingDelete ? "Точно удалить долг?" : "Удалить долг"}
          </button>
        )}
      </div>
    </div>
  );
}
