import { useState } from "react";
import { haptic, hapticHeavy } from "../haptics";
import { formatAmountDisplay, sanitizeAmountInput } from "../amountInput";

// "Баланс" — tap the number to correct it against your real bank balance.
// `editable` is false for the "Все счета" aggregate (nothing single to edit
// there). `balance` null means no baseline has been set yet for this wallet.
export default function AccountBalanceRow({ balance, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function startEdit() {
    if (!editable || saving) return;
    haptic();
    setValue(balance != null ? balance.toFixed(2) : "");
    setError("");
    setEditing(true);
  }

  async function commit() {
    const num = Number(value.replace(",", "."));
    if (!Number.isFinite(num)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(num);
      hapticHeavy();
      setEditing(false);
    } catch (err) {
      // Keep editing open with the typed value and surface the failure —
      // it used to close silently and revert to the old number, so a save
      // that failed offline looked exactly like one that succeeded.
      setError(err.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="balance-row-wrap">
        <div className="balance-row">
          <span className="balance-label">Баланс</span>
          <input
            className="balance-input"
            type="text"
            inputMode="decimal"
            autoFocus
            value={formatAmountDisplay(value)}
            onChange={(event) => {
              const raw = sanitizeAmountInput(event.target.value);
              if (raw !== null) setValue(raw);
            }}
            onBlur={commit}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        </div>
        {error && <p className="balance-error">{error}</p>}
      </div>
    );
  }

  return (
    <button className={`balance-row ${editable ? "" : "readonly"}`} onClick={startEdit}>
      <span className="balance-label">Баланс</span>
      <span className="balance-value">
        {balance != null
          ? `${balance.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`
          : editable
          ? "Указать сумму"
          : "—"}
      </span>
    </button>
  );
}
