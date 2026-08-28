import { useRef, useState } from "react";
import { listCategories } from "../categoryIcons";
import { listWallets } from "../wallets";
import { haptic, hapticHeavy, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

export default function CategoriesSheet({ initialWallet, onClose, onAdd, onEdit, onDelete }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const wallets = listWallets();
  const [activeWallet, setActiveWallet] = useState(initialWallet || wallets[0]?.name);
  const [confirmingName, setConfirmingName] = useState(null);
  const categories = listCategories(activeWallet);

  function pickWallet(name) {
    haptic();
    setActiveWallet(name);
    setConfirmingName(null);
  }

  async function handleDelete(name) {
    if (confirmingName !== name) {
      haptic();
      setConfirmingName(name);
      return;
    }
    hapticHeavy();
    setConfirmingName(null);
    await onDelete(activeWallet, name);
  }

  return (
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Категории</span>
          <button
            className="icon-button"
            onClick={() => {
              haptic();
              onAdd(activeWallet);
            }}
            aria-label="Новая категория"
          >
            +
          </button>
        </div>

        <div className="type-toggle">
          <span className="type-side income">↙</span>
          <span className="type-side expense active">↗ Расход</span>
        </div>

        <div className="wallet-tabs">
          {wallets.map((w) => (
            <button
              key={w.name}
              className={`period-pill ${activeWallet === w.name ? "active" : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              onClick={() => pickWallet(w.name)}
            >
              <CategoryGlyph emoji={w.emoji} size={14} /> {w.name}
            </button>
          ))}
        </div>

        <div className="cats-list">
          {categories.map((cat) => (
            <div className="cat-row" key={cat.name}>
              <span className="category-icon" style={catIconVars(cat.bg, cat.fg)}>
                <CategoryGlyph emoji={cat.emoji} size={20} />
              </span>
              <span className="cat-name">{cat.name}</span>
              <button
                className="wallet-edit"
                aria-label="Редактировать категорию"
                onClick={() => {
                  haptic();
                  onEdit(activeWallet, cat);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15.5 5.5 18.5 8.5 8 19l-4 1 1-4L15.5 5.5Z" />
                </svg>
              </button>
              <button
                className="cat-delete"
                aria-label="Удалить категорию"
                onClick={() => handleDelete(cat.name)}
              >
                {confirmingName === cat.name ? "Точно?" : "✕"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
