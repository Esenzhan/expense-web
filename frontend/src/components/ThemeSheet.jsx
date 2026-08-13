import { useRef, useState } from "react";
import { haptic } from "../haptics";
import { useSwipeDismissRight } from "../sheetGestures";

export const THEME_OPTIONS = [
  { value: "system", label: "Системная" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

export const THEME_LABELS = Object.fromEntries(THEME_OPTIONS.map((o) => [o.value, o.label]));

export default function ThemeSheet({ theme, onChange, onClose }) {
  const [closing, setClosing] = useState(false);
  const pageRef = useRef(null);
  useSwipeDismissRight(pageRef, onClose);

  function handleClose() {
    if (closing) return;
    haptic();
    setClosing(true);
    const el = pageRef.current;
    if (el) {
      el.style.transition = "transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)";
      el.style.transform = "translateX(100%)";
    }
    setTimeout(onClose, 260);
  }

  function pick(value) {
    if (value === theme) return;
    haptic();
    onChange(value);
  }

  return (
    <div ref={pageRef} className="settings-page">
      <div className="settings-header">
        <button className="icon-button" onClick={handleClose} aria-label="Назад">
          ‹
        </button>
        <span className="settings-title">Тема</span>
        <span className="icon-button-spacer" />
      </div>

      <div className="settings-group">
        {THEME_OPTIONS.map((opt) => (
          <button key={opt.value} className="settings-row" onClick={() => pick(opt.value)}>
            <span className="settings-row-label">{opt.label}</span>
            {opt.value === theme && <span className="settings-row-value">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
