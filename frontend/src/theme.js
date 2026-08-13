export const THEME_KEY = "traty-theme";
export const THEME_OPTIONS = ["system", "light", "dark"];

const DARK_THEME_COLOR = "#0a0a0c";
const LIGHT_THEME_COLOR = "#F4F4F6";

export function loadLocalTheme() {
  const value = localStorage.getItem(THEME_KEY);
  return THEME_OPTIONS.includes(value) ? value : "system";
}

// Sets data-theme on <html> (skipped for "system" — prefers-color-scheme in
// styles.css already covers that case) and syncs the browser-chrome color.
// Exported standalone (not tied to React state) so main.jsx can call it
// synchronously before the first paint, avoiding a flash of the wrong theme.
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  meta.setAttribute("content", isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
}

export function setLocalTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
