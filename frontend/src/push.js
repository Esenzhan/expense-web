// Web Push needs the VAPID public key as a Uint8Array, not the base64url
// string it's normally shared as — this is the standard conversion snippet.
export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// iOS only supports Web Push for a PWA added to the Home Screen — a plain
// Safari tab silently can't subscribe, even with permission granted.
export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
