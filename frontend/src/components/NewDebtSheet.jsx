import { useRef, useState } from "react";
import { listWallets } from "../wallets";
import { createDebt } from "../api";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

// «Новый долг» — свайп-down шторка, открывается «+» в DebtsSheet. Счёт
// опционален: указан только когда деньги реально прошли через отслеживаемый
// счёт (тогда баланс двигается сразу же на бэкенде, см. routes/debts.js),
// «Без счёта» — для наличных/долгов, которые не должны влиять на баланс.
export default function NewDebtSheet({ initialDirection, onClose, onCreated }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const wallets = listWallets();
  const [direction, setDirection] = useState(initialDirection || "owed_to_us");
  const [scope, setScope] = useState("personal");
  const [counterparty, setCounterparty] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [wallet, setWallet] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const num = Number(amount.replace(",", "."));
    if (!counterparty.trim()) {
      setError("Укажите, с кем долг");
      return;
    }
    if (!Number.isFinite(num) || num <= 0) {
      setError("Введите сумму больше нуля");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createDebt({
        direction,
        scope,
        counterparty: counterparty.trim(),
        description: description.trim() || null,
        amount: num,
        wallet,
        dueDate: dueDate || null,
      });
      hapticHeavy();
      onCreated();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Новый долг</span>
          <span className="icon-button-spacer" />
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

        <div className="debt-direction-toggle">
          <button
            className={`period-pill ${scope === "personal" ? "active" : ""}`}
            onClick={() => {
              haptic();
              setScope("personal");
            }}
          >
            Личный
          </button>
          <button
            className={`period-pill ${scope === "family" ? "active" : ""}`}
            onClick={() => {
              haptic();
              setScope("family");
            }}
          >
            Семейный
          </button>
        </div>

        <input
          className="note-input"
          type="text"
          placeholder="С кем долг (имя)"
          value={counterparty}
          maxLength={60}
          onChange={(event) => {
            setCounterparty(event.target.value);
            setError("");
          }}
        />

        <div className="balance-row" style={{ marginTop: 12 }}>
          <span className="balance-label">Сумма</span>
          <input
            className="balance-input"
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
          />
        </div>

        <input
          className="note-input"
          type="text"
          placeholder="Комментарий (необязательно)"
          value={description}
          maxLength={200}
          onChange={(event) => setDescription(event.target.value)}
        />

        <label className="period-picker-field" style={{ marginTop: 12 }}>
          <span>Дата погашения (необязательно)</span>
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
        </label>

        <p className="newcat-group-title">Счёт (необязательно)</p>
        <div className="wallet-pick-row">
          <button
            type="button"
            className={`wallet-pick ${wallet === null ? "active" : ""}`}
            onClick={() => {
              haptic();
              setWallet(null);
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
              className={`wallet-pick ${wallet === w.name ? "active" : ""}`}
              onClick={() => {
                haptic();
                setWallet(w.name);
              }}
            >
              <span className="wallet-pick-icon" style={catIconVars(w.bg, w.fg)}>
                <CategoryGlyph emoji={w.emoji} size={18} />
              </span>
              <span className="wallet-pick-label">{w.name}</span>
            </button>
          ))}
        </div>
        {wallet && (
          <p className="debt-hint">
            {direction === "owed_to_us"
              ? `Баланс «${wallet}» сразу уменьшится на сумму долга.`
              : `Баланс «${wallet}» сразу увеличится на сумму долга.`}
          </p>
        )}

        {error && <p className="sheet-error">{error}</p>}

        <button className="sheet-close" onClick={handleSave} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
