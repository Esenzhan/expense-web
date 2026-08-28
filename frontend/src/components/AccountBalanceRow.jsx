import { useState } from "react";
import { haptic, hapticHeavy } from "../haptics";
import { formatAmountDisplay, sanitizeAmountInput } from "../amountInput";

// "Баланс" — tap the number to correct it against your real bank balance.
// `editable` is false for the "Все счета" aggregate (nothing single to edit
// there). `balance` null means no baseline has been set yet for this wallet.
//
// Saving is deliberately explicit — an appearing "Сохранить" that asks
// again before it writes. This used to commit on blur, so a stray tap
// anywhere else on the screen silently re-anchored the balance (and a
// balance re-anchor is not a small edit: it resets base_at, so everything
// logged before that moment stops counting against it — see
// routes/walletBalances.js). Nothing here writes without two taps.
export default function AccountBalanceRow({ balance, editable, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsed = Number(value.replace(",", "."));
  const valid = value.trim() !== "" && Number.isFinite(parsed);
  // Comparing the numbers, not the strings: "1000" and "1000.00" are the
  // same balance, and re-saving one is a pointless re-anchor.
  const changed = valid && (balance == null || parsed !== Number(balance.toFixed(2)));

  function startEdit() {
    if (!editable || saving) return;
    haptic();
    setValue(balance != null ? balance.toFixed(2) : "");
    setError("");
    setConfirming(false);
    setEditing(true);
  }

  function cancel() {
    haptic();
    setEditing(false);
    setConfirming(false);
    setError("");
  }

  async function handleSave() {
    if (!changed || saving) return;
    // First tap arms, second one writes.
    if (!confirming) {
      haptic();
      setConfirming(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(parsed);
      hapticHeavy();
      setEditing(false);
      setConfirming(false);
    } catch (err) {
      // Keep editing open with the typed value and surface the failure —
      // it used to close silently and revert to the old number, so a save
      // that failed offline looked exactly like one that succeeded.
      setError(err.message || "Не удалось сохранить");
      setConfirming(false);
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
              if (raw === null) return;
              setValue(raw);
              // Typing again after arming has to disarm — otherwise the
              // next tap would save a number the confirmation never showed.
              setConfirming(false);
              setError("");
            }}
            // Enter only dismisses the keyboard; the save is the button.
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        </div>
        {error && <p className="balance-error">{error}</p>}
        <div className="balance-actions">
          <button className="balance-action" onClick={cancel} disabled={saving}>
            Отмена
          </button>
          <button
            className={`balance-action primary ${confirming ? "confirming" : ""}`}
            onClick={handleSave}
            disabled={!changed || saving}
          >
            {saving ? "Сохраняю…" : confirming ? "Точно сохранить?" : "Сохранить"}
          </button>
        </div>
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
