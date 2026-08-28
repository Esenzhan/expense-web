import { useRef, useState } from "react";
import { listCategories } from "../categoryIcons";
import { listWallets } from "../wallets";
import { haptic, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

// Строка категории — целиком кнопка: тап открывает правку, и удаление
// живёт уже там, в меню шапки. Раньше на строке висели карандаш и ✕ с
// подтверждением прямо в списке — тот же путь, что у трат (тап по строке →
// правка → меню → удалить), только у категорий он был свой.
export default function CategoriesSheet({ initialWallet, onClose, onAdd, onEdit }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const wallets = listWallets();
  const [activeWallet, setActiveWallet] = useState(initialWallet || wallets[0]?.name);
  const categories = listCategories(activeWallet);

  function pickWallet(name) {
    haptic();
    setActiveWallet(name);
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
            <button
              className="cat-row"
              key={cat.name}
              onClick={() => {
                haptic();
                onEdit(activeWallet, cat);
              }}
            >
              <span className="category-icon" style={catIconVars(cat.bg, cat.fg)}>
                <CategoryGlyph emoji={cat.emoji} size={20} />
              </span>
              <span className="cat-name">{cat.name}</span>
              <span className="cat-row-chevron" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m10 7 5 5-5 5" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
