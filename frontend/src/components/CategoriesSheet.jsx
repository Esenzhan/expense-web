import { useEffect, useRef, useState } from "react";
import { listCategories } from "../categoryIcons";
import { listWallets } from "../wallets";
import { haptic, hapticTick, withHaptic } from "../haptics";
import { useSwipeDismiss } from "../sheetGestures";
import CategoryGlyph from "./CategoryGlyph";
import { catIconVars } from "../catIconVars";

// Press-and-hold before a drag starts, so an ordinary scroll that begins on
// the handle still scrolls. Matches the platform feel for reorder handles.
const HOLD_MS = 260;
// Finger travel that cancels the pending hold — that was a scroll, not a grab.
const HOLD_SLOP = 8;

// Шесть точек — та же ручка, что в референсе (Qalta): взялся и тащишь.
function DragHandle() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {[5, 9, 13].map((cy) =>
        [6.5, 11.5].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.35" fill="currentColor" />)
      )}
    </svg>
  );
}

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
  const [drag, setDrag] = useState(null); // { from, to, dy }

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

  const listRef = useRef(null);
  const dragRef = useRef(null);
  const holdTimerRef = useRef(null);
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  useEffect(() => () => clearTimeout(holdTimerRef.current), []);

  function pickWallet(name) {
    haptic();
    setActiveWallet(name);
    setLocalOrder(null); // another wallet, another list
  }

  function onHandleTouchStart(event, index) {
    const touch = event.touches[0];
    const startY = touch.clientY;
    const startX = touch.clientX;
    // Row pitch measured from the two first rows, so the gap between them is
    // included without hardcoding it from CSS.
    const rows = listRef.current?.children;
    const step =
      rows && rows.length > 1
        ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top
        : rows?.[0]?.getBoundingClientRect().height || 0;

    const pending = { index, startX, startY, step, active: false };
    dragRef.current = pending;

    clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      if (dragRef.current !== pending) return;
      pending.active = true;
      haptic(); // "поднял"
      setDrag({ from: index, to: index, dy: 0 });
    }, HOLD_MS);

    function onMove(moveEvent) {
      const state = dragRef.current;
      if (!state) return;
      const t = moveEvent.touches[0];
      const dy = t.clientY - state.startY;

      if (!state.active) {
        // Still waiting on the hold — any real movement means a scroll.
        if (Math.abs(dy) > HOLD_SLOP || Math.abs(t.clientX - state.startX) > HOLD_SLOP) {
          clearTimeout(holdTimerRef.current);
          cleanup();
        }
        return;
      }

      moveEvent.preventDefault(); // dragging owns the gesture now
      const count = categoriesRef.current.length;
      const raw = state.index + (state.step ? Math.round(dy / state.step) : 0);
      const to = Math.max(0, Math.min(count - 1, raw));
      setDrag((prev) => {
        if (prev && prev.to !== to) hapticTick(); // прошли ещё одну позицию
        return { from: state.index, to, dy };
      });
    }

    function onEnd() {
      const state = dragRef.current;
      clearTimeout(holdTimerRef.current);
      if (state?.active) commitDrag();
      cleanup();
    }

    function cleanup() {
      dragRef.current = null;
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    }

    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
  }

  function commitDrag() {
    setDrag((current) => {
      if (!current) return null;
      const { from, to } = current;
      if (from !== to) {
        const names = categoriesRef.current.map((c) => c.name);
        const [moved] = names.splice(from, 1);
        names.splice(to, 0, moved);
        haptic();
        setLocalOrder(names);
        // A failed save just falls back to the server's order on the next
        // hydration — nothing to undo by hand.
        Promise.resolve(onReorder?.(activeWallet, names)).catch(() => setLocalOrder(null));
      }
      return null;
    });
  }

  // Where a row sits while a drag is in progress: the dragged one follows the
  // finger, everything between its old and new slot steps aside by one row.
  function rowOffset(index) {
    if (!drag) return 0;
    const { from, to, dy } = drag;
    if (index === from) return dy;
    const step = dragRef.current?.step || 0;
    if (from < to && index > from && index <= to) return -step;
    if (from > to && index >= to && index < from) return step;
    return 0;
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
