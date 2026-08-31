// Shared line-icon (matches TrashIcon and the app's other hand-drawn glyphs)
// — the "change the date" button on every sheet that has one: adding and
// editing an expense, adding and editing a capital snapshot.
export default function CalendarIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </svg>
  );
}
