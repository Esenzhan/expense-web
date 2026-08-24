import { useEffect, useRef } from "react";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";
import { haptic } from "../haptics";

// Popover dropdown anchored to the "Категория" chip (see ExpenseList) —
// same visual language as EditExpenseSheet's .edit-menu (absolute-positioned
// popover, menu-pop animation), extended with a category icon per row.
// Closes on any pointerdown outside itself, not just on picking a row.
export default function CategoryFilterDropdown({ expenseCategories, incomeCategories, selected, onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function onPointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  function choose(key) {
    haptic();
    onSelect(key);
    onClose();
  }

  function Row({ itemKey, icon, name }) {
    const current = selected === itemKey;
    return (
      <button className={`dropdown-item ${current ? "current" : ""}`} onClick={() => choose(itemKey)}>
        {icon && (
          <span className="category-icon dropdown-item-icon" style={catIconVars(icon.bg, icon.fg)}>
            <CategoryGlyph emoji={icon.emoji} size={15} />
          </span>
        )}
        <span className="dropdown-item-name">{name}</span>
        {current && <span className="dropdown-item-check">✓</span>}
      </button>
    );
  }

  return (
    <div className="category-filter-dropdown" ref={ref}>
      <Row itemKey={null} icon={null} name="Все категории" />
      {expenseCategories.length > 0 && (
        <>
          <p className="dropdown-group-label">Расходы</p>
          {expenseCategories.map((cat) => (
            <Row key={cat.key} itemKey={cat.key} icon={cat.icon} name={cat.name} />
          ))}
        </>
      )}
      {incomeCategories.length > 0 && (
        <>
          <p className="dropdown-group-label">Доходы</p>
          {incomeCategories.map((cat) => (
            <Row key={cat.key} itemKey={cat.key} icon={cat.icon} name={cat.name} />
          ))}
        </>
      )}
    </div>
  );
}
