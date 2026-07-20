import { useEffect, useRef } from "react";
import { haptic, hapticHeavy } from "../haptics";

const BASE_HEIGHT = 38; // matches .insights-button padding/font at rest
const MAX_HEIGHT = 150; // fully stretched blob, like the reference video
const PULL_DISTANCE = 170; // finger travel (px) for a full stretch

// The «✦ Инсайты» button. Opens on tap, and also on a long downward drag:
// the pill stretches into a tall blob while the label fades out and the
// sparkle grows/rotates, with haptic ticks as the pull deepens — release past
// the threshold opens the sheet, otherwise it springs back.
export default function InsightsButton({ onOpen }) {
  const btnRef = useRef(null);
  const iconRef = useRef(null);
  const labelRef = useRef(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const btn = btnRef.current;
    const state = { pulling: false, startY: 0, progress: 0, zone: 0 };

    function paint(progress, springBack) {
      btn.style.transition = springBack
        ? "height 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.35), border-radius 0.35s ease"
        : "none";
      btn.style.height = `${BASE_HEIGHT + (MAX_HEIGHT - BASE_HEIGHT) * progress}px`;
      // Pill (radius clamps to half-height) flattening into a rounded square
      btn.style.borderRadius = `${75 - 47 * progress}px`;
      const labelVisibility = Math.max(0, 1 - progress * 2.5);
      labelRef.current.style.opacity = `${labelVisibility}`;
      labelRef.current.style.maxWidth = `${labelVisibility * 70}px`;
      iconRef.current.style.transform = `scale(${1 + progress * 1.4}) rotate(${progress * 30}deg)`;
    }

    function onTouchStart(event) {
      state.pulling = true;
      state.startY = event.touches[0].clientY;
      state.progress = 0;
      state.zone = 0;
    }

    function onTouchMove(event) {
      if (!state.pulling) return;
      const dy = event.touches[0].clientY - state.startY;
      if (dy <= 0) {
        state.progress = 0;
        paint(0, false);
        return;
      }
      event.preventDefault(); // hijack the drag from page scroll
      const progress = Math.min(1, dy / PULL_DISTANCE);
      state.progress = progress;
      paint(progress, false);

      // Tick every quarter of the pull, a heavier thump on reaching the top
      const zone = Math.floor(progress * 4);
      if (zone > state.zone) {
        state.zone = zone;
        if (zone >= 4) hapticHeavy();
        else haptic();
      } else if (zone < state.zone) {
        state.zone = zone;
      }
    }

    function onTouchEnd() {
      if (!state.pulling) return;
      state.pulling = false;
      const shouldOpen = state.progress >= 0.95;
      paint(0, true);
      state.progress = 0;
      if (shouldOpen) onOpenRef.current?.();
    }

    btn.addEventListener("touchstart", onTouchStart, { passive: true });
    btn.addEventListener("touchmove", onTouchMove, { passive: false });
    btn.addEventListener("touchend", onTouchEnd);
    btn.addEventListener("touchcancel", onTouchEnd);
    return () => {
      btn.removeEventListener("touchstart", onTouchStart);
      btn.removeEventListener("touchmove", onTouchMove);
      btn.removeEventListener("touchend", onTouchEnd);
      btn.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return (
    <button
      ref={btnRef}
      className="insights-button"
      onClick={() => {
        haptic();
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
