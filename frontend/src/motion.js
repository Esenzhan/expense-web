import { useCallback, useEffect, useRef } from "react";

export const MOTION_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
export const DRAWER_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export function motionAllowed() {
  return !matchMedia("(prefers-reduced-motion: reduce)").matches &&
    document.documentElement.dataset.motionEnabled !== "false" &&
    document.documentElement.dataset.inputMethod !== "keyboard";
}

// Reuse the real node: interrupted opening continues from its current pose.
// Cleanup cancels completion, so closing a child cannot later close a new panel.
export function useMotionDismiss(ref, onDismiss, direction = "down") {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  const running = useRef(null);
  useEffect(() => () => { running.current?.cancel(); running.current = null; }, []);
  return useCallback((after) => {
    if (running.current) return;
    const done = typeof after === "function" ? after : () => latest.current?.();
    const el = ref.current;
    if (!el || !motionAllowed()) { done(); return; }
    const start = getComputedStyle(el).transform;
    el.getAnimations().forEach((a) => a.cancel());
    el.style.animation = "none";
    el.dataset.motionClosing = "true";
    const animation = el.animate([
      { transform: start === "none" ? "translate(0, 0)" : start, opacity: 1 },
      { transform: direction === "right" ? "translateX(100%)" : direction === "popover" ? "scale(.97)" : "translateY(105%)", opacity: direction === "popover" ? 0 : 1 },
    ], { duration: direction === "popover" ? 160 : 260, easing: DRAWER_EASE, fill: "forwards" });
    const backdrop = el.parentElement?.matches(".sheet-backdrop") ? el.parentElement : null;
    const fade = backdrop?.animate([{ opacity: getComputedStyle(backdrop).opacity }, { opacity: 0 }], { duration: 260, easing: MOTION_EASE, fill: "forwards" });
    let cancelled = false;
    running.current = { cancel() { cancelled = true; animation.cancel(); fade?.cancel(); delete el.dataset.motionClosing; } };
    animation.finished.then(() => { if (!cancelled) done(); }).catch(() => {});
  }, [ref, direction]);
}

export function installPressMotion() {
  let pressed = null;
  let pressAnimation = null;
  let startX = 0;
  let startY = 0;
  function release() {
    if (!pressed) return;
    const el = pressed;
    const current = getComputedStyle(el).scale;
    el.removeAttribute("data-pressed");
    pressAnimation?.cancel();
    pressAnimation = null;
    pressed = null;
    if (el.isConnected && motionAllowed()) {
      el.animate([{ scale: current === "none" ? "1" : current }, { scale: "1" }], { duration: 160, easing: MOTION_EASE });
    }
  }
  function pointerDown(event) {
    document.documentElement.dataset.inputMethod = "pointer";
    release();
    if (!event.isPrimary || event.button !== 0 || !motionAllowed()) return;
    // The calculator stays immediate; never scale a draggable carousel item.
    const el = event.target.closest("button:not(.key):not(:disabled), .expense-row:not(.readonly), .search-result-row:not(.readonly)");
    if (!el || el.closest("[data-motion-closing], .reorder-dragging")) return;
    pressed = el; startX = event.clientX; startY = event.clientY;
    el.setAttribute("data-pressed", "true");
    const scale = el.matches(".mic-button, .side-button") ? ".92" : el.matches(".expense-row, .search-result-row") ? ".985" : ".96";
    // Animate only individual scale, leaving every existing CSS transition intact.
    pressAnimation = el.animate([{ scale: "1" }, { scale }], { duration: 100, easing: MOTION_EASE, fill: "forwards" });
  }
  function move(event) { if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) release(); }
  function keyboard() { release(); document.documentElement.dataset.inputMethod = "keyboard"; }
  document.addEventListener("pointerdown", pointerDown, true);
  document.addEventListener("pointermove", move, { passive: true, capture: true });
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
  document.addEventListener("keydown", keyboard, true);
  window.addEventListener("blur", release);
  return () => {
    release();
    document.removeEventListener("pointerdown", pointerDown, true);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", release, true);
    document.removeEventListener("pointercancel", release, true);
    document.removeEventListener("keydown", keyboard, true);
    window.removeEventListener("blur", release);
  };
}
