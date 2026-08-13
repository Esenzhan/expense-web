import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { applyTheme, loadLocalTheme } from "./theme.js";

// Runs before the first render (not inside a React effect) so there's no
// flash of the wrong theme on load.
const initialTheme = loadLocalTheme();
applyTheme(initialTheme);
if (initialTheme === "system") {
  // Keep the browser-chrome color (status bar / address bar) in sync if the
  // OS theme flips while the app is open — data-theme itself needs no
  // listener here since it's already unset and prefers-color-scheme in
  // styles.css reacts on its own.
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => applyTheme("system"));
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // no-op: app still works without the service worker, just without the instant-open cache
    });
  });
}
