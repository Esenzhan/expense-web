import { useState } from "react";
import { haptic, hapticHeavy } from "../haptics";

// "Деньги на счету" — tap the number to correct it against your real bank
// balance. `editable` is false for the "Все счета" aggregate (nothing
// single to edit there). `balance` null means no baseline has been set yet
// for this wallet.
export default function AccountBalanceRow({ balance, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    if (!editable || saving) return;
    haptic();
    setValue(balance != null ? String(Math.round(balance)) : "");
    setEditing(true);
  }

  async function commit() {
    const num = Number(value.replace(",", "."));
    if (!Number.isFinite(num)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(num);
      hapticHeavy();
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="balance-row">
        <span className="balance-label">Деньги на счету</span>
        <input
          className="balance-input"
          type="number"
          inputMode="decimal"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
      </div>
    );
  }

  return (
    <button className={`balance-row ${editable ? "" : "readonly"}`} onClick={startEdit}>
      <span className="balance-label">Деньги на счету</span>
      <span className="balance-value">
        {balance != null
          ? `${Math.round(balance).toLocaleString("ru-RU")} ₸`
          : editable
          ? "Указать сумму"
          : "—"}
      </span>
    </button>
  );
}
