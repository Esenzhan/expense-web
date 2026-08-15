import { useEffect, useRef, useState } from "react";
import { listWallets } from "../wallets";
import { fetchDebtPayments, payDebt, deleteDebt } from "../api";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import { almaty } from "../insights";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

function formatAmount(amount) {
  return `${Number(amount).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`;
}

function formatWhen(iso) {
  const shifted = almaty(new Date(iso));
  const date = shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", timeZone: "UTC" });
  const time = shifted.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return `${date}, ${time}`;
}

// Открывается тапом по строке в DebtsSheet — детали долга, история платежей
// и форма погашения (полного или частичного). Удаление доступно только пока
// не было ни одного платежа (см. routes/debts.js — иначе пришлось бы
// откатывать историю баланса по каждому платежу).
export default function DebtDetailSheet({ debt: initialDebt, onClose, onChanged }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const wallets = listWallets();
  const [debt, setDebt] = useState(initialDebt);
  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [payAmount, setPayAmount] = useState("");
  const [payWallet, setPayWallet] = useState(debt.wallet || null);
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
      const updated = await payDebt(debt.id, num, payWallet);
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
            <span className="settings-row-label">Осталось</span>
            <span className="settings-row-value">
              {debt.status === "closed" ? "Погашено" : formatAmount(debt.remaining)}
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

        {debt.status === "open" && (
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

            <div className="wallet-pick-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className={`wallet-pick ${payWallet === null ? "active" : ""}`}
                onClick={() => {
                  haptic();
                  setPayWallet(null);
                }}
              >
                <span className="wallet-pick-icon" style={{ background: "var(--surface)", color: "var(--ink-soft)" }}>
                  ⃠
                </span>
                <span className="wallet-pick-label">Без счёта</span>
              </button>
              {wallets.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  className={`wallet-pick ${payWallet === w.name ? "active" : ""}`}
                  onClick={() => {
                    haptic();
                    setPayWallet(w.name);
                  }}
                >
                  <span className="wallet-pick-icon" style={catIconVars(w.bg, w.fg)}>
                    <CategoryGlyph emoji={w.emoji} size={18} />
                  </span>
                  <span className="wallet-pick-label">{w.name}</span>
                </button>
              ))}
            </div>

            {error && <p className="sheet-error">{error}</p>}

            <button className="sheet-close" onClick={handlePay} disabled={saving}>
              {saving ? "Сохраняю…" : "Погасить"}
            </button>
          </>
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
