import { useRef, useState } from "react";
import { listWallets } from "../wallets";
import { transferBetweenWallets } from "../api";
import { haptic, hapticHeavy, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

// «Переводы»: move money from one wallet's balance to another — re-bases
// both (same anchor mechanism as a manual "Баланс" edit), no expense rows
// involved. Opened from WalletsSheet's header, next to "+".
export default function WalletTransferSheet({ initialFrom, onClose, onTransferred }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const wallets = listWallets();
  const [from, setFrom] = useState(initialFrom || wallets[0]?.name);
  const [to, setTo] = useState(wallets.find((w) => w.name !== (initialFrom || wallets[0]?.name))?.name || "");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function pick(setter, name) {
    haptic();
    setter(name);
    setError("");
  }

  async function handleSave() {
    const num = Number(amount.replace(",", "."));
    if (!Number.isFinite(num) || num <= 0) {
      setError("Введите сумму больше нуля");
      return;
    }
    if (from === to) {
      setError("Выберите разные счета");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await transferBetweenWallets(from, to, num);
      hapticHeavy();
      onTransferred();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Перевод между счетами</span>
          <span className="icon-button-spacer" />
        </div>

        <p className="newcat-group-title">Откуда</p>
        <div className="wallet-pick-row">
          {wallets.map((w) => (
            <button
              key={w.name}
              type="button"
              className={`wallet-pick ${from === w.name ? "active" : ""}`}
              onClick={() => pick(setFrom, w.name)}
            >
              <span className="wallet-pick-icon" style={catIconVars(w.bg, w.fg)}>
                <CategoryGlyph emoji={w.emoji} size={18} />
              </span>
              <span className="wallet-pick-label">{w.name}</span>
            </button>
          ))}
        </div>

        <p className="newcat-group-title">Куда</p>
        <div className="wallet-pick-row">
          {wallets.map((w) => (
            <button
              key={w.name}
              type="button"
              className={`wallet-pick ${to === w.name ? "active" : ""}`}
              onClick={() => pick(setTo, w.name)}
            >
              <span className="wallet-pick-icon" style={catIconVars(w.bg, w.fg)}>
                <CategoryGlyph emoji={w.emoji} size={18} />
              </span>
              <span className="wallet-pick-label">{w.name}</span>
            </button>
          ))}
        </div>

        <div className="balance-row" style={{ marginTop: 16 }}>
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

        {error && <p className="sheet-error">{error}</p>}

        <button className="sheet-close" onClick={handleSave} disabled={saving}>
          {saving ? "Перевожу…" : "Перевести"}
        </button>
      </div>
    </div>
  );
}
