import { useEffect, useRef } from "react";
import { haptic, hapticHeavy, hapticTick } from "../haptics";

const BASE_HEIGHT = 38; // matches .insights-button padding/font at rest
const MAX_HEIGHT = 150; // fully stretched blob, like the reference video
const PULL_DISTANCE = 170; // finger travel (px) for a full stretch
// Sub-pixel scroll offsets (momentum can settle at 0.3px) still count as
// "the very top" — the gesture would otherwise feel randomly dead.
const TOP_EPSILON = 1;

// The «✦ Инсайты» button. Opens on tap, and also on a long downward drag
// started anywhere on the page while it's scrolled to the very top: the pill
// stretches into a tall blob while the label fades out and the sparkle
// grows/rotates, with haptic ticks as the pull deepens — release past the
// threshold opens the sheet, otherwise it springs back.
export default function InsightsButton({ onOpen }) {
  const btnRef = useRef(null);
  const iconRef = useRef(null);
  const labelRef = useRef(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const btn = btnRef.current;
    const state = { armed: false, pulling: false, startY: 0, progress: 0, zone: 0 };

    function paint(progress, springBack) {
      btn.style.transition = springBack
        ? "height 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.35), border-radius 0.35s ease, gap 0.35s ease"
        : "none";
      btn.style.height = `${BASE_HEIGHT + (MAX_HEIGHT - BASE_HEIGHT) * progress}px`;
      // Pill (radius clamps to half-height) flattening into a rounded square
      btn.style.borderRadius = `${75 - 47 * progress}px`;
      const labelVisibility = Math.max(0, 1 - progress * 2.5);
      labelRef.current.style.opacity = `${labelVisibility}`;
      labelRef.current.style.maxWidth = `${labelVisibility * 70}px`;
      // Collapse the flex gap along with the label, otherwise the sparkle
      // sits a few px left of the blob's center once the label is gone
      btn.style.gap = `${labelVisibility * 6}px`;
      iconRef.current.style.transform = `scale(${1 + progress * 3}) rotate(${progress * 30}deg)`;
    }

    // BODY is the scroll container here, not the window: styles.css gives
    // html/body height:100% plus overflow-x:hidden, and a non-visible overflow
    // on one axis computes the other to `auto`. So window.scrollY and
    // documentElement.scrollTop sit at 0 no matter how far the list is
    // scrolled — reading only those is why the "top of the page" guard below
    // never actually fired and the pull armed mid-list. Math.max also folds
    // iOS's negative rubber-band offsets back to 0, which is right: at the
    // bounce past the top there's nowhere left to scroll, so the pull should
    // take over.
    function pageScrollTop() {
      return Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop);
    }

    // armed: a candidate touch began at the top of the page;
    // pulling: the drag showed clear downward intent and now drives the button
    function onTouchStart(event) {
      state.armed = false;
      state.pulling = false;
      if (pageScrollTop() > TOP_EPSILON) return;
      // Only the main screen owns this gesture — touches inside overlays
      // (sheets, mic dock, settings page) must scroll/act normally. Expense
      // rows run their own axis-locked horizontal-swipe gesture (see
      // ExpenseRow.jsx) — without this exclusion a swipe that drifts a few
      // px vertically gets picked up by BOTH this document-level listener
      // and the row's own, racing each other for the same touch.
      if (
        event.target.closest?.(
          ".sheet-backdrop, .recorder-dock, .recorder-backdrop, .settings-page, .expense-row-wrap"
        )
      ) {
        return;
      }
      state.armed = true;
      state.startY = event.touches[0].clientY;
      state.progress = 0;
      state.zone = 0;
    }

    function onTouchMove(event) {
      if (!state.armed) return;
      const dy = event.touches[0].clientY - state.startY;

      if (!state.pulling) {
        if (dy < -6 || pageScrollTop() > TOP_EPSILON) {
          // The gesture became a normal scroll — stand down for this touch
          state.armed = false;
          return;
        }
        if (dy < 8) return; // not enough intent yet
        state.pulling = true;
        hapticTick(); // "grabbed" cue
      }

      if (dy <= 0) {
        state.progress = 0;
        paint(0, false);
        return;
      }
      event.preventDefault(); // hijack the drag from page scroll
      const progress = Math.min(1, dy / PULL_DISTANCE);
      state.progress = progress;
      paint(progress, false);

      // Detent tick every eighth of the pull — in both directions, like a
      // ratchet — with a heavier thump on first reaching the top
      const zone = Math.floor(progress * 8);
      if (zone !== state.zone) {
        if (zone >= 8 && state.zone < 8) hapticHeavy();
        else hapticTick();
        state.zone = zone;
      }
    }

    function onTouchEnd() {
      const wasPulling = state.pulling;
      state.armed = false;
      state.pulling = false;
      if (!wasPulling) return;
      const shouldOpen = state.progress >= 0.95;
      paint(0, true);
      state.progress = 0;
      if (shouldOpen) {
        // Android buzzes here via navigator.vibrate; iOS web can't vibrate
        // outside real click handlers at all (confirmed on-device), so on
        // iPhone the swipe stays silent by platform design
        hapticHeavy();
        onOpenRef.current?.();
      }
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return (
    <button
      ref={btnRef}
      className="insights-button"
      onClick={() => {
        hapticHeavy();
        onOpen();
      }}
    >
      <span ref={iconRef} className="insights-btn-icon">
        ✦
      </span>
      <span ref={labelRef} className="insights-btn-label">
        Инсайты
      </span>
    </button>
  );
}
