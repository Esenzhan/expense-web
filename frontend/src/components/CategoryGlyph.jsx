// Minimalist one-color line icons for the built-in categories, drawn to
// match the reference app's style: stroke-only glyphs that inherit the
// category's `fg` color via currentColor. Keyed by the category's emoji
// (that's the stable identifier stored in the DB); user-created categories
// with arbitrary emoji simply fall back to rendering the emoji itself.
const GLYPHS = {
  // Кафе и рестораны — fork & knife
  "🍴": (
    <>
      <path d="M7 3v5.5M4.5 3v5.5M9.5 3v5.5" />
      <path d="M7 8.5V21" />
      <path d="M16.5 3c-1.7 1-2.5 3.2-2.5 5.5 0 2 .9 3 2.5 3s2.5-1 2.5-3c0-2.3-.8-4.5-2.5-5.5Z" />
      <path d="M16.5 11.5V21" />
    </>
  ),
  // Продукты — shopping basket
  "🛒": (
    <>
      <path d="M4 10h16l-1.6 8.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 10Z" />
      <path d="M8.5 10 12 4l3.5 6" />
      <path d="M9.5 13.5v3M14.5 13.5v3" />
    </>
  ),
  // Такси — car
  "🚕": (
    <>
      <path d="M5 12 6.6 7.6A2 2 0 0 1 8.5 6.3h7a2 2 0 0 1 1.9 1.3L19 12" />
      <path d="M4.5 12h15a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V13a1 1 0 0 1 1-1Z" />
      <path d="M7 17.5v1.7M17 17.5v1.7" />
      <path d="M7 14.8h.01M17 14.8h.01" />
    </>
  ),
  // Транспорт — bus
  "🚌": (
    <>
      <rect x="5" y="4" width="14" height="13" rx="2.5" />
      <path d="M5 10.5h14" />
      <path d="M8 17v2M16 17v2" />
      <path d="M8.5 14h.01M15.5 14h.01" />
    </>
  ),
  // Связь и интернет — phone
  "📱": (
    <>
      <rect x="7.5" y="3" width="9" height="18" rx="2.2" />
      <path d="M11 17.8h2" />
    </>
  ),
  // Развлечения — gamepad
  "🎮": (
    <>
      <path d="M7.5 7.5h9a5 5 0 0 1 4.9 6 5 5 0 0 1-1.6 2.8c-1 .8-2.4.6-3.2-.4l-1.2-1.5h-6.8l-1.2 1.5c-.8 1-2.2 1.2-3.2.4a5 5 0 0 1-1.6-2.8 5 5 0 0 1 4.9-6Z" />
      <path d="M8.7 10.2v3M7.2 11.7h3" />
      <path d="M15.3 10.4h.01M17 12h.01" />
    </>
  ),
  // Здоровье — pulse
  "💊": (
    <>
      <path d="M3.5 12h4l2-5 4 10 2.5-5h4.5" />
    </>
  ),
  // Одежда — t-shirt
  "👕": (
    <>
      <path d="m9 4-4.5 2.6 1.6 3.6L8.5 9v10.5h7V9l2.4 1.2 1.6-3.6L15 4a3 3 0 0 1-6 0Z" />
    </>
  ),
  // Жильё — house
  "🏠": (
    <>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-6h4v6" />
    </>
  ),
  // Прочее — credit card
  "💳": (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.2" />
      <path d="M3 10h18" />
      <path d="M6.5 14.5h4" />
    </>
  ),
};

export default function CategoryGlyph({ emoji, size = 22 }) {
  const glyph = GLYPHS[emoji];
  if (!glyph) return emoji;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyph}
    </svg>
  );
}
