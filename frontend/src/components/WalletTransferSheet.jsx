import { useRef, useState } from "react";
import { listWallets, walletCurrency } from "../wallets";
import { currencySymbol } from "../currencies";
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
  // Куда переводить можно только в той же валюте: перевод переносит число,
  // а курса в этом пути нет (см. routes/walletTransfers.js). Поэтому «Куда»
  // показывает не все счета, а только совместимые — вместо того чтобы дать
  // выбрать несовместимый и отбить его ошибкой уже на сохранении.
  function targetsFor(source) {
    return wallets.filter((w) => w.name !== source && walletCurrency(w.name) === walletCurrency(source));
  }

  const initialSource = initialFrom || wallets[0]?.name;
  const [from, setFrom] = useState(initialSource);
  const [to, setTo] = useState(() => targetsFor(initialSource)[0]?.name || "");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const targets = targetsFor(from);
  const symbol = currencySymbol(walletCurrency(from));

  function pick(setter, name) {
    haptic();
    setter(name);
    setError("");
  }

  // Смена счёта-источника может увести выбранного получателя в другую
  // валюту — тогда выбираем первого совместимого вместо него, чтобы в
  // «Куда» никогда не оставалась подсвеченной строка, которой там уже нет.
  function pickFrom(name) {
    haptic();
    setFrom(name);
    setError("");
    const nextTargets = targetsFor(name);
    if (!nextTargets.some((w) => w.name === to)) setTo(nextTargets[0]?.name || "");
  }

  async function handleSave() {
    const num = Number(amount.replace(",", "."));
    if (!Number.isFinite(num) || num <= 0) {
      setError("Введите сумму больше нуля");
      return;
    }
    if (!to || from === to) {
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
              onClick={() => pickFrom(w.name)}
            >
              <span className="wallet-pick-icon" style={catIconVars(w.bg, w.fg)}>
                <CategoryGlyph emoji={w.emoji} size={18} />
              </span>
              <span className="wallet-pick-label">{w.name}</span>
            </button>
          ))}
        </div>

        <p className="newcat-group-title">Куда</p>
        {targets.length > 0 ? (
          <div className="wallet-pick-row">
            {targets.map((w) => (
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
        ) : (
          <p className="empty-hint">
            Нет другого счёта в {symbol} — перевести можно только между счетами одной валюты.
          </p>
        )}

        <div className="balance-row" style={{ marginTop: 16 }}>
          <span className="balance-label">Сумма, {symbol}</span>
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

        <button className="sheet-close" onClick={handleSave} disabled={saving || !to}>
          {saving ? "Перевожу…" : "Перевести"}
        </button>
      </div>
    </div>
  );
}
