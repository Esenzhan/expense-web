// Feeds a category/wallet color pair to the .category-icon/.wallet-chip-icon
// CSS rules (styles.css) as custom properties instead of literal
// background/color — that's what lets those rules invert bg/fg for dark
// mode (see styles.css) without every call site needing to know the theme.
export function catIconVars(bg, fg) {
  return { "--cat-bg": bg, "--cat-fg": fg };
}
