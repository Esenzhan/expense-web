import { useEffect, useRef } from "react";
import CategoryGlyph from "./CategoryGlyph";
import { hapticHeavy } from "../haptics";
import { catIconVars } from "../catIconVars";

// Drag left reveals a fixed-width delete button behind the row; releasing
// past half that width snaps it open, otherwise it springs back closed.
// Deleting only ever happens by tapping the button. BUTTON_WIDTH must match
// the width in styles.css's .expense-row-delete rule. OVERDRAG allows a
// little elastic overtravel past the button while dragging.
const BUTTON_WIDTH = 76;
const OVERDRAG = 24;

function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16" />
      <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
      <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export default function ExpenseRow({ expense, icon, readonly, onSelect, onDeleteRequest }) {
  const rowRef = useRef(null);
  const wrapRef = useRef(null);
  const onDeleteRef = useRef(onDeleteRequest);
  onDeleteRef.current = onDeleteRequest;

  // Whether the touch that just ended was a swipe — checked by the click
  // handler so a swipe doesn't also open the edit sheet, and to know
  // whether the row is currently sitting open.
  const swipedRef = useRef(false);
  const gestureRef = useRef({ axis: null, startX: 0, startY: 0, dx: 0, baseDx: 0, open: false });

  function paint(dx, animate) {
    const el = rowRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.22s ease" : "none";
    el.style.transform = `translateX(${dx}px)`;
    // Reveals the delete button only while actually shifted — see the CSS
    // comment on .expense-row-delete-btn for why this can't just rely on
    // the row's own background to hide it.
    wrapRef.current?.classList.toggle("swiping", dx !== 0);
  }

  function setOpen(open, animate) {
    gestureRef.current.open = open;
    paint(open ? -BUTTON_WIDTH : 0, animate);
  }

  useEffect(() => {
    const el = rowRef.current;
    if (!el || readonly) return;

    // Axis is decided once per touch and then locked: "h" owns the gesture
    // and suppresses page scroll, "v" hands the touch back to the scroller.
    const state = gestureRef.current;

    function onTouchStart(event) {
      state.axis = null;
      state.startX = event.touches[0].clientX;
      state.startY = event.touches[0].clientY;
      state.baseDx = state.open ? -BUTTON_WIDTH : 0;
      state.dx = state.baseDx;
      swipedRef.current = false;
    }

    function onTouchMove(event) {
      const dxRaw = event.touches[0].clientX - state.startX;
      const dyRaw = event.touches[0].clientY - state.startY;

      if (state.axis === null) {
        // Not enough movement to tell the axis apart yet
        if (Math.abs(dxRaw) < 8 && Math.abs(dyRaw) < 8) return;
        state.axis = Math.abs(dxRaw) > Math.abs(dyRaw) ? "h" : "v";
      }
      if (state.axis === "v") return; // vertical scroll owns this touch

      // Horizontal: block the page from scrolling for the rest of this touch
      if (event.cancelable) event.preventDefault();
      swipedRef.current = true;
      const next = Math.min(0, Math.max(-(BUTTON_WIDTH + OVERDRAG), state.baseDx + dxRaw));
      state.dx = next;
      paint(next, false);
    }

    function onTouchEnd() {
      state.axis = null;
      if (!swipedRef.current) return;
      setOpen(Math.abs(state.dx) > BUTTON_WIDTH / 2, true);
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // Must be non-passive: React's own onTouchMove is registered as passive,
    // so preventDefault() (the thing that stops the vertical scroll) is
    // ignored there — same reason sheetGestures.js binds by hand.
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [readonly]);

  function handleClick() {
    if (swipedRef.current) return; // that was a swipe, not a tap
    if (gestureRef.current.open) {
      setOpen(false, true); // tapping the row while open just closes it
      return;
    }
    if (!readonly) onSelect?.(expense);
  }

  function handleDeleteClick() {
    hapticHeavy();
    onDeleteRef.current?.(expense);
  }

  return (
    <div className={`expense-row-wrap ${expense.exiting ? "exiting" : ""}`} ref={wrapRef}>
      <div className="expense-row-delete">
        <button type="button" className="expense-row-delete-btn" onClick={handleDeleteClick} aria-label="Удалить">
          <TrashIcon />
        </button>
      </div>
      <div
        className={`expense-row ${expense.pending ? "pending" : ""} ${readonly ? "readonly" : ""}`}
        ref={rowRef}
        onClick={handleClick}
      >
        <span className="category-icon" style={catIconVars(icon.bg, icon.fg)}>
          <CategoryGlyph emoji={icon.emoji} size={20} />
        </span>
        <div className="meta">
          <span className="category">{expense.category}</span>
          {expense.description && <span className="sub">{expense.description}</span>}
        </div>
        <span className="amount">
          −{Number(expense.amount).toLocaleString("ru-RU")} ₸
          {expense.pending && (
            <span className="pending-badge" title="Сохранено на телефоне, отправится при подключении к сети">
              ⏳
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
