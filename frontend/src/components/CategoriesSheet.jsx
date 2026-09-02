import { useRef, useState } from "react";
import { listCategories } from "../categoryIcons";
import { listWallets } from "../wallets";
import { haptic, withHaptic } from "../haptics";
import { DragHandle, useReorderDrag } from "./ReorderDrag";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

// Строка категории — целиком кнопка: тап открывает правку, и удаление
// живёт уже там, в меню шапки. Раньше на строке висели карандаш и ✕ с
// подтверждением прямо в списке — тот же путь, что у трат (тап по строке →
// правка → меню → удалить), только у категорий он был свой.
//
// Порядок меняется перетаскиванием за ручку справа: зажал — строка
// поднимается, соседи расступаются, отпустил — порядок уходит на сервер
// (`onReorder`). Пока сохранение летит, список показывает уже новый
// порядок: `localOrder` живёт до тех пор, пока не приедет свежая гидрация.
export default function CategoriesSheet({ initialWallet, onClose, onAdd, onEdit, onReorder }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const wallets = listWallets();
  const [activeWallet, setActiveWallet] = useState(initialWallet || wallets[0]?.name);
  const serverCategories = listCategories(activeWallet);
  const [localOrder, setLocalOrder] = useState(null);

  // Ordered view: the just-dropped arrangement while the save is in flight,
  // then whatever the server hydration says once it lands.
  const categories = (() => {
    if (!localOrder) return serverCategories;
    const byName = new Map(serverCategories.map((c) => [c.name, c]));
    const ordered = localOrder.map((n) => byName.get(n)).filter(Boolean);
    // Anything the local order doesn't know about (added elsewhere since)
    // goes to the end rather than disappearing.
    for (const c of serverCategories) if (!localOrder.includes(c.name)) ordered.push(c);
    return ordered;
  })();

  // Перетаскивание живёт в общем хуке — тот же жест, что в списке счетов.
  // Провалившееся сохранение просто откатывается к серверному порядку на
  // следующей гидрации, руками отменять нечего.
  const { drag, listRef, rowOffset, onHandleTouchStart } = useReorderDrag(
    categories.map((c) => c.name),
    (names) => {
      setLocalOrder(names);
      Promise.resolve(onReorder?.(activeWallet, names)).catch(() => setLocalOrder(null));
    }
  );

  function pickWallet(name) {
    haptic();
    setActiveWallet(name);
    setLocalOrder(null); // another wallet, another list
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

        <div className="cats-list" ref={listRef}>
          {categories.map((cat, index) => (
            <div
              className={`cat-row-wrap ${drag?.from === index ? "dragging" : ""}`}
              key={cat.name}
              style={{ transform: `translateY(${rowOffset(index)}px)` }}
            >
              <button
                className="cat-row"
                onClick={() => {
                  if (drag) return; // that was a drag, not a tap
                  haptic();
                  onEdit(activeWallet, cat);
                }}
              >
                <span className="category-icon" style={catIconVars(cat.bg, cat.fg)}>
                  <CategoryGlyph emoji={cat.emoji} size={20} />
                </span>
                <span className="cat-name">{cat.name}</span>
              </button>
              <span
                className="cat-drag-handle"
                onTouchStart={(event) => onHandleTouchStart(event, index)}
                aria-label="Перетащить"
                role="button"
              >
                <DragHandle />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
