import { useRef } from "react";
import { listWallets } from "../wallets";
import { haptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";

// «Счета»: pick the wallet the whole main screen is scoped to, add new ones,
// or edit an existing one via the pencil.
export default function WalletsSheet({ totals, selected, onSelect, onAdd, onEdit, onClose }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const wallets = listWallets();
  const totalOf = (name) => Number(totals.find((t) => t.wallet === name)?.total || 0);
  const allTotal = totals.reduce((sum, t) => sum + Number(t.total), 0);

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
          <span className="wallet-row-total">−{allTotal.toLocaleString("ru-RU")} ₸</span>
        </button>

        <div className="cats-list">
          {wallets.map((wallet) => (
            <div
              className={`wallet-row ${selected === wallet.name ? "current" : ""}`}
              key={wallet.name}
              onClick={() => choose(wallet.name)}
            >
              <span className="category-icon" style={{ background: wallet.bg, color: wallet.fg }}>
                {wallet.emoji}
              </span>
              <span className="cat-name">{wallet.name}</span>
              <span className="wallet-row-total">
                −{totalOf(wallet.name).toLocaleString("ru-RU")} ₸
              </span>
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
