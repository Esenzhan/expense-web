// Cross-platform haptic tap.
// - Android Chrome: navigator.vibrate.
// - iOS Safari: no Vibration API at all, but toggling an
//   <input type="checkbox" switch> via a programmatic label click fires the
//   system haptic tick (works on iOS 17.4–26.4; Apple closed the programmatic
//   path in 26.5 — real user toggles still buzz, scripted ones become no-ops).
let hapticLabel = null;

function ensureSwitch() {
  if (hapticLabel) return hapticLabel;
  hapticLabel = document.createElement("label");
  hapticLabel.style.cssText =
    "position:fixed;top:-100px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  hapticLabel.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  hapticLabel.appendChild(input);
  document.body.appendChild(hapticLabel);
  return hapticLabel;
}

export function haptic() {
  if (navigator.vibrate) {
    navigator.vibrate(10);
    return;
  }
  try {
    ensureSwitch().click();
  } catch {
    // no haptics on this device/OS — silently fine
  }
}

// Tick for continuous gestures (drag detents), throttled so rapid detents
// don't coalesce. Android-only in practice: navigator.vibrate works from any
// handler, while iOS delivers the switch-toggle haptic exclusively from real
// click handlers (confirmed on-device) — so no switch fallback here, it
// would just toggle a checkbox for nothing mid-drag.
let lastTickAt = 0;
export function hapticTick() {
  const now = Date.now();
  if (now - lastTickAt < 100) return;
  lastTickAt = now;
  navigator.vibrate?.(8);
}

export function hapticHeavy() {
  if (navigator.vibrate) {
    navigator.vibrate([15, 40, 20]);
    return;
  }
  try {
    const label = ensureSwitch();
    // First click synchronous — iOS drops toggles deferred out of the
    // gesture handler's call stack. The 120ms follow-up still lands within
    // the post-gesture activation window and reads as a distinct double.
    label.click();
    setTimeout(() => label.click(), 120);
  } catch {
    // no haptics — fine
  }
}
