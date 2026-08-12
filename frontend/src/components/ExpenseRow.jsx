import { useEffect, useRef } from "react";
import CategoryGlyph from "./CategoryGlyph";
import { haptic } from "../haptics";

// Drag past this and releasing deletes; below it the row springs back.
const COMMIT_DISTANCE = 96;
const MAX_DRAG = 150;

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

// Swipe-left-to-delete, like the reference app: the red zone grows with the
// drag and deleting fires on release once past COMMIT_DISTANCE — there's no
// separate tap on the trash icon.
export default function ExpenseRow({ expense, icon, readonly, onSelect, onDeleteRequest }) {
  const rowRef = useRef(null);
  const zoneRef = useRef(null);
  const iconRef = useRef(null);
  const onDeleteRef = useRef(onDeleteRequest);
  onDeleteRef.current = onDeleteRequest;

  // Whether the touch that just ended was a swipe — checked by the click
  // handler so a swipe doesn't also open the edit sheet.
  const swipedRef = useRef(false);

  useEffect(() => {
    const el = rowRef.current;
    if (!el || readonly) return;

    // Axis is decided once per touch and then locked: "h" owns the gesture
    // and suppresses page scroll, "v" hands the touch back to the scroller.
    const state = { axis: null, startX: 0, startY: 0, dx: 0, armed: false };

    function paint(dx, animate) {
      const zone = zoneRef.current;
      el.style.transition = animate ? "transform 0.22s ease" : "none";
      el.style.transform = `translateX(${dx}px)`;
      if (zone) {
        zone.style.transition = animate ? "width 0.22s ease" : "none";
        zone.style.width = `${Math.abs(dx)}px`;
        zone.classList.toggle("armed", Math.abs(dx) >= COMMIT_DISTANCE);
      }
      if (iconRef.current) {
        iconRef.current.style.opacity = `${0.3 + 0.7 * Math.min(1, Math.abs(dx) / COMMIT_DISTANCE)}`;
      }
    }

    function onTouchStart(event) {
      state.axis = null;
      state.startX = event.touches[0].clientX;
      state.startY = event.touches[0].clientY;
      state.dx = 0;
      state.armed = false;
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
      if (dxRaw >= 0) {
        // Rightward — nothing to reveal, keep the row closed
        state.dx = 0;
        paint(0, false);
        return;
      }

      // Horizontal: block the page from scrolling for the rest of this touch
      if (event.cancelable) event.preventDefault();
      swipedRef.current = true;
      const next = Math.max(-MAX_DRAG, dxRaw);
      state.dx = next;
      // Buzz exactly when crossing the commit threshold, so the point of no
      // return is felt without looking
      const armedNow = Math.abs(next) >= COMMIT_DISTANCE;
      if (armedNow !== state.armed) {
        state.armed = armedNow;
        if (armedNow) haptic();
      }
      paint(next, false);
    }

    function onTouchEnd() {
      const committed = Math.abs(state.dx) >= COMMIT_DISTANCE;
      state.axis = null;
      state.dx = 0;
      state.armed = false;
      if (committed) {
        // The parent hides the row immediately and opens the undo window,
        // so this node is on its way out — no spring-back animation.
        onDeleteRef.current?.(expense);
        return;
      }
      paint(0, true);
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
  }, [expense, readonly]);

  function handleClick() {
    if (swipedRef.current) return; // that was a swipe, not a tap
    if (!readonly) onSelect?.(expense);
  }

  return (
    <div className="expense-row-wrap">
      <div className="expense-row-delete" ref={zoneRef} aria-hidden="true">
        <span className="expense-row-delete-icon" ref={iconRef}>
          <TrashIcon />
        </span>
      </div>
      <div
        className={`expense-row ${expense.pending ? "pending" : ""} ${readonly ? "readonly" : ""}`}
        ref={rowRef}
        onClick={handleClick}
      >
        <span className="category-icon" style={{ background: icon.bg, color: icon.fg }}>
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
