import { useRef } from "react";
import { listWallets } from "../wallets";
import { haptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

// «Счета»: pick the wallet the whole main screen is scoped to, add new ones,
// or edit an existing one via the pencil.
export default function WalletsSheet({ balances, pendingWalletDeltas, selected, onSelect, onAdd, onEdit, onClose }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const wallets = listWallets();
  // Same formula as accountBalance in App.jsx's "Баланс" row — a wallet with
  // no balance entry (never given a starting amount) has none to show here
  // either, and the pending delta keeps an in-flight add/undo-window delete
  // reflected instantly instead of only after its server round-trip lands.
  const balanceOf = (name) => {
    const entry = balances.find((b) => b.wallet === name);
    return entry ? Number(entry.current_balance) - (pendingWalletDeltas.get(name) || 0) : null;
  };
  const allBalance = balances.length
    ? balances.reduce((sum, b) => sum + Number(b.current_balance) - (pendingWalletDeltas.get(b.wallet) || 0), 0)
    : null;
  const formatBalance = (amount) =>
    amount != null
      ? `${amount.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`
      : "—";

  function choose(name) {
    haptic();
    onSelect(name);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Счета</span>
          <div className="cats-header-actions">
            <button
              className="icon-button"
              onClick={() => {
                haptic();
                onAdd();
              }}
              aria-label="Новый счёт"
            >
              +
            </button>
            <button className="icon-button" aria-label="Сортировка">
              ⇅
            </button>
          </div>
        </div>

        <button
          className={`wallet-row all ${selected === null ? "current" : ""}`}
          onClick={() => choose(null)}
        >
          <span className="cat-name">Все счета</span>
          <span className="wallet-row-total">{formatBalance(allBalance)}</span>
        </button>

        <div className="cats-list">
          {wallets.map((wallet) => (
            <div
              className={`wallet-row ${selected === wallet.name ? "current" : ""}`}
              key={wallet.name}
              onClick={() => choose(wallet.name)}
            >
              <span className="category-icon" style={catIconVars(wallet.bg, wallet.fg)}>
                <CategoryGlyph emoji={wallet.emoji} size={20} />
              </span>
              <span className="cat-name">{wallet.name}</span>
              <span className="wallet-row-total">{formatBalance(balanceOf(wallet.name))}</span>
              <button
                className="wallet-edit"
                aria-label="Редактировать"
                onClick={(event) => {
                  event.stopPropagation();
                  haptic();
                  onEdit(wallet);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15.5 5.5 18.5 8.5 8 19l-4 1 1-4L15.5 5.5Z" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
