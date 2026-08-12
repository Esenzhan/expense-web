import { useRef, useState } from "react";
import { listCategories } from "../categoryIcons";
import { listWallets } from "../wallets";
import { haptic, hapticHeavy } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";

export default function CategoriesSheet({ initialWallet, onClose, onAdd, onDelete }) {
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
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
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
              onClick={() => pickWallet(w.name)}
            >
              {w.emoji} {w.name}
            </button>
          ))}
        </div>

        <div className="cats-list">
          {categories.map((cat) => (
            <div className="cat-row" key={cat.name}>
              <span className="category-icon" style={{ background: cat.bg, color: cat.fg }}>
                <CategoryGlyph emoji={cat.emoji} size={20} />
              </span>
              <span className="cat-name">{cat.name}</span>
              {cat.name !== "Прочее" && (
                <button
                  className="cat-delete"
                  aria-label="Удалить категорию"
                  onClick={() => handleDelete(cat.name)}
                >
                  {confirmingName === cat.name ? "Точно?" : "✕"}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
