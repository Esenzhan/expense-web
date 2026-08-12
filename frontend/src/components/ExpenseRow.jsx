import { useEffect, useRef } from "react";
import CategoryGlyph from "./CategoryGlyph";

const REVEAL_WIDTH = 76;

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

// Swipe-left-to-reveal-delete, one row open at a time (isOpen/onOpen/onClose
// are owned by the parent list so opening one row can close another).
export default function ExpenseRow({ expense, icon, readonly, isOpen, onOpen, onClose, onSelect, onDeleteRequest }) {
  const contentRef = useRef(null);
  const gesture = useRef({ dragging: false, deciding: true, startX: 0, startY: 0, dx: 0 });

  // Snap closed whenever this row stops being the open one — including when
  // a *different* row opens and this one wasn't dragged at all.
  useEffect(() => {
    if (!isOpen && contentRef.current) {
      contentRef.current.style.transition = "transform 0.22s ease";
      contentRef.current.style.transform = "translateX(0)";
    }
  }, [isOpen]);

  function onTouchStart(event) {
    gesture.current = {
      dragging: false,
      deciding: true,
      startX: event.touches[0].clientX,
      startY: event.touches[0].clientY,
      dx: isOpen ? -REVEAL_WIDTH : 0,
    };
  }

  function onTouchMove(event) {
    const g = gesture.current;
    const dx = event.touches[0].clientX - g.startX;
    const dy = event.touches[0].clientY - g.startY;
    if (g.deciding) {
      // Vertical scroll intent, or dragging right from an already-closed
      // row (nothing to reveal) — not ours, let the list scroll normally.
      if (Math.abs(dy) > Math.abs(dx)) return;
      if (dx > 4 && g.dx === 0) return;
      if (Math.abs(dx) < 6) return;
      g.deciding = false;
      g.dragging = true;
      onOpen();
    }
    if (!g.dragging) return;
    event.preventDefault();
    const base = isOpen ? -REVEAL_WIDTH : 0;
    g.dx = Math.min(0, Math.max(-REVEAL_WIDTH, base + dx));
    if (contentRef.current) {
      contentRef.current.style.transition = "none";
      contentRef.current.style.transform = `translateX(${g.dx}px)`;
    }
  }

  function onTouchEnd() {
    const g = gesture.current;
    if (!g.dragging) return;
    g.dragging = false;
    const openNow = g.dx < -REVEAL_WIDTH / 2;
    if (contentRef.current) {
      contentRef.current.style.transition = "transform 0.22s ease";
      contentRef.current.style.transform = `translateX(${openNow ? -REVEAL_WIDTH : 0}px)`;
    }
    if (openNow) onOpen();
    else onClose();
  }

  function handleRowClick() {
    if (isOpen) {
      onClose();
      return;
    }
    if (!readonly) onSelect?.(expense);
  }

  return (
    <div className="expense-row-wrap">
      {!readonly && (
        <button
          className="expense-row-delete"
          aria-label="Удалить"
          onClick={() => {
            onClose();
            onDeleteRequest?.(expense);
          }}
        >
          <TrashIcon />
        </button>
      )}
      <div
        className={`expense-row ${expense.pending ? "pending" : ""} ${readonly ? "readonly" : ""}`}
        ref={contentRef}
        onClick={handleRowClick}
        onTouchStart={readonly ? undefined : onTouchStart}
        onTouchMove={readonly ? undefined : onTouchMove}
        onTouchEnd={readonly ? undefined : onTouchEnd}
        onTouchCancel={readonly ? undefined : onTouchEnd}
      >
        <span className="category-icon" style={{ background: icon.bg, color: icon.fg }}>
          <CategoryGlyph emoji={icon.emoji} size={20} />
        </span>
        <div className="meta">
          <span className="category">{expense.category}</span>
          <span className="sub">{expense.wallet}</span>
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
