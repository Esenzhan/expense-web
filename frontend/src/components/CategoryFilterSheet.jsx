import { useRef } from "react";
import { haptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

// Filters the main screen's "Последние траты" list down to one category.
// The lists it renders (expenseCategories/incomeCategories) are built by
// the caller from whatever rows are actually loaded, not the full category
// registry — so there's never an option here that would filter down to an
// empty list.
export default function CategoryFilterSheet({
  expenseCategories,
  incomeCategories,
  selected,
  onSelect,
  onClose,
}) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  function choose(key) {
    haptic();
    onSelect(key);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="categories-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Категория</span>
          <div className="icon-button-spacer" />
        </div>

        <button className={`wallet-row all ${selected === null ? "current" : ""}`} onClick={() => choose(null)}>
          <span className="cat-name">Все категории</span>
        </button>

        {expenseCategories.length > 0 && (
          <>
            <p className="section-title">Расходы</p>
            <div className="cats-list">
              {expenseCategories.map((cat) => (
                <button
                  key={cat.key}
                  className={`wallet-row ${selected === cat.key ? "current" : ""}`}
                  onClick={() => choose(cat.key)}
                >
                  <span className="category-icon" style={catIconVars(cat.icon.bg, cat.icon.fg)}>
                    <CategoryGlyph emoji={cat.icon.emoji} size={20} />
                  </span>
                  <span className="cat-name">{cat.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {incomeCategories.length > 0 && (
          <>
            <p className="section-title">Доходы</p>
            <div className="cats-list">
              {incomeCategories.map((cat) => (
                <button
                  key={cat.key}
                  className={`wallet-row ${selected === cat.key ? "current" : ""}`}
                  onClick={() => choose(cat.key)}
                >
                  <span className="category-icon" style={catIconVars(cat.icon.bg, cat.icon.fg)}>
                    <CategoryGlyph emoji={cat.icon.emoji} size={20} />
                  </span>
                  <span className="cat-name">{cat.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
