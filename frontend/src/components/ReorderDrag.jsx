import { useEffect, useRef, useState } from "react";
import { haptic, hapticTick } from "../haptics";

// Press-and-hold before a drag starts, so an ordinary scroll that begins on
// the handle still scrolls. Matches the platform feel for reorder handles.
const HOLD_MS = 260;
// Finger travel that cancels the pending hold — that was a scroll, not a grab.
const HOLD_SLOP = 8;

// Шесть точек — та же ручка, что в референсе (Qalta): взялся и тащишь.
export function DragHandle() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {[5, 9, 13].map((cy) =>
        [6.5, 11.5].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.35" fill="currentColor" />)
      )}
    </svg>
  );
}

// Перетаскивание строк за ручку — общее для списка категорий и списка
// счетов. Жест один и тот же (зажал, поднял, соседи расступаются), и жить
// он должен в одном месте: сто строк работы с касаниями, скопированные во
// второй файл, разъедутся при первой же правке.
//
// `keys` — имена строк в текущем порядке; `onCommit(newKeys)` вызывается
// один раз при отпускании, если порядок реально изменился. Пока сохранение
// летит, показывается уже новый порядок — за это отвечает вызывающий,
// возвращая свежий `keys`.
export function useReorderDrag(keys, onCommit) {
  const [drag, setDrag] = useState(null); // { from, to, dy }
  const listRef = useRef(null);
  const dragRef = useRef(null);
  const holdTimerRef = useRef(null);
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => () => clearTimeout(holdTimerRef.current), []);

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
      const count = keysRef.current.length;
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
        const next = [...keysRef.current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        haptic();
        onCommit(next);
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

  return { drag, listRef, rowOffset, onHandleTouchStart };
}
