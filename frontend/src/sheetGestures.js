import { useEffect, useRef } from "react";

// Locks the page behind an open sheet. Deliberately NOT the position:fixed
// body trick: on iOS that offsets the body by the scroll position and the
// fixed sheet ends up anchored to the shifted box — a page scrolled by N px
// showed the sheet floating N px above the bottom edge, with a strip of
// undimmed page visible below it. overflow:hidden keeps the scroll offset
// and moves nothing; leaked touch scrolling is stopped by preventDefault on
// the backdrop (see useSwipeDismiss) + overscroll-behavior on the sheets.
let lockCount = 0;

export function useBodyScrollLock() {
  useEffect(() => {
    if (++lockCount === 1) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    }
    return () => {
      if (--lockCount === 0) {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
      }
    };
  }, []);
}

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
    const state = { armed: false, pulling: false, startY: 0, dy: 0 };

    function onTouchStart(event) {
      state.armed = el.scrollTop <= 0;
      state.pulling = false;
      state.startY = event.touches[0].clientY;
      state.dy = 0;
    }

    function onTouchMove(event) {
      if (!state.armed) return;
      const dy = event.touches[0].clientY - state.startY;
      if (!state.pulling) {
        if (dy < -4 || el.scrollTop > 0) {
          state.armed = false; // became an internal scroll
          return;
        }
        if (dy < 10) return;
        state.pulling = true;
      }
      state.dy = dy;
      event.preventDefault();
      el.style.transition = "none";
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }

    function onTouchEnd() {
      const wasPulling = state.pulling;
      state.armed = false;
      state.pulling = false;
      if (!wasPulling) return;
      el.style.transition = "transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)";
      if (state.dy > 130) {
        el.style.transform = "translateY(110%)";
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
      }
      state.dy = 0;
    }

    // Drags on the dimmed area around the sheet must not scroll the page
    // behind (overflow:hidden alone doesn't stop iOS touch scroll-chaining)
    const backdrop = el.parentElement;
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
