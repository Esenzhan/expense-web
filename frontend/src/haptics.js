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

// Tick for continuous gestures (drag detents). Two differences from haptic():
// the switch click is deferred out of the touchmove call stack — WebKit
// appears to drop toggles fired synchronously mid-drag — and calls are
// throttled so rapid detents don't coalesce into nothing.
let lastTickAt = 0;
export function hapticTick() {
  const now = Date.now();
  if (now - lastTickAt < 100) return;
  lastTickAt = now;
  if (navigator.vibrate) {
    navigator.vibrate(8);
    return;
  }
  setTimeout(() => {
    try {
      ensureSwitch().click();
    } catch {
      // no haptics — fine
    }
  }, 0);
}

export function hapticHeavy() {
  if (navigator.vibrate) {
    navigator.vibrate([15, 40, 20]);
    return;
  }
  try {
    const label = ensureSwitch();
    // Both clicks deferred: this can be called from inside a touchmove
    // handler, where synchronous switch toggles get dropped. ~120ms apart
    // reads as a distinct double tick; much closer and iOS coalesces the
    // two toggles into one buzz.
    setTimeout(() => label.click(), 0);
    setTimeout(() => label.click(), 120);
  } catch {
    // no haptics — fine
  }
}
