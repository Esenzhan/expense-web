import { useEffect, useRef } from "react";

// NOTE on background scroll-locking: both classic tricks are broken here —
// position:fixed on body makes iOS anchor the fixed sheet to the shifted
// body box (sheet floats above the bottom edge when the page was scrolled),
// and overflow:hidden on html resets the scroll position to the top. So the
// page is never touched at all; instead every touch while a sheet is open is
// contained at the touch level: the backdrop preventDefaults drags on the
// dim area (below), and the sheets keep their internal scrolling to
// themselves via overscroll-behavior: contain.

// Swipe-down-to-dismiss for a bottom sheet. Engages only when the sheet's
// own scroll is at the top and the drag shows clear downward intent, so
// internal scrolling keeps working; release past the threshold slides the
// sheet out and calls onClose, otherwise it springs back.
export function useSwipeDismiss(sheetRef, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const backdrop = el.parentElement;
    const state = { armed: false, pulling: false, startX: 0, startY: 0, dy: 0 };

    // The dim fades out in step with the pull and comes back on spring-back
    function paintBackdrop(progress, animate) {
      if (!backdrop) return;
      backdrop.style.transition = animate
        ? "background-color 0.26s ease, backdrop-filter 0.26s ease"
        : "none";
      backdrop.style.backgroundColor = `rgba(20, 20, 26, ${0.4 * (1 - progress)})`;
      backdrop.style.backdropFilter = `blur(${4 * (1 - progress)}px)`;
    }

    function resetBackdrop() {
      if (!backdrop) return;
      backdrop.style.transition = "background-color 0.26s ease, backdrop-filter 0.26s ease";
      backdrop.style.backgroundColor = "";
      backdrop.style.backdropFilter = "";
    }

    function onTouchStart(event) {
      state.armed = el.scrollTop <= 0;
      state.pulling = false;
      state.startX = event.touches[0].clientX;
      state.startY = event.touches[0].clientY;
      state.dy = 0;
    }

    function onTouchMove(event) {
      if (!state.armed) return;
      const dx = event.touches[0].clientX - state.startX;
      const dy = event.touches[0].clientY - state.startY;
      if (!state.pulling) {
        // Horizontal intent (e.g. the category carousel) or an internal
        // scroll — stand down for this touch
        if (dy < -4 || el.scrollTop > 0 || Math.abs(dx) > Math.abs(dy)) {
          state.armed = false;
          return;
        }
        if (dy < 10) return;
        state.pulling = true;
      }
      state.dy = dy;
      event.preventDefault();
      el.style.transition = "none";
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
      paintBackdrop(Math.min(1, Math.max(0, dy) / el.offsetHeight), false);
    }

    function onTouchEnd() {
      const wasPulling = state.pulling;
      state.armed = false;
      state.pulling = false;
      if (!wasPulling) return;
      el.style.transition = "transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)";
      if (state.dy > 130) {
        el.style.transform = "translateY(110%)";
        paintBackdrop(1, true); // dim finishes fading with the slide-out
        // Unmount exactly when the slide-out finishes — a fixed timeout
        // shorter than the transition left the sheet's top edge hanging at
        // the bottom of the screen for a frame or two
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          onCloseRef.current?.();
        };
        el.addEventListener("transitionend", close, { once: true });
        setTimeout(close, 350); // fallback if transitionend never fires
      } else {
        el.style.transform = "translateY(0)";
        resetBackdrop();
      }
      state.dy = 0;
    }

    // Drags on the dimmed area around the sheet must not scroll the page
    // behind (overflow:hidden alone doesn't stop iOS touch scroll-chaining)
    function onBackdropMove(event) {
      if (event.target === backdrop) event.preventDefault();
    }
    backdrop?.addEventListener("touchmove", onBackdropMove, { passive: false });

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      backdrop?.removeEventListener("touchmove", onBackdropMove);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [sheetRef]);
}
