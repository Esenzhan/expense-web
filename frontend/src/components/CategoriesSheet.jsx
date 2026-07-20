import { useRef } from "react";
import { listCategories } from "../categoryIcons";
import { haptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";

export default function CategoriesSheet({ onClose, onAdd }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);
  const categories = listCategories();

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
              onAdd();
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

        <div className="cats-list">
          {categories.map((cat) => (
            <div className="cat-row" key={cat.name}>
              <span className="category-icon" style={{ background: cat.bg, color: cat.fg }}>
                <CategoryGlyph emoji={cat.emoji} size={20} />
              </span>
              <span className="cat-name">{cat.name}</span>
              <span className="drag-handle" aria-hidden="true">
                ⠿
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
