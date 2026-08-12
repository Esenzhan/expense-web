import { useRef, useState } from "react";
import { useSwipeDismiss } from "../sheetGestures";
import { haptic } from "../haptics";

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

// Custom "От — До" range for the main screen's period toggle. Dates are
// plain YYYY-MM-DD (no time) — periodRange() in insights.js treats them as
// inclusive Almaty calendar days.
export default function PeriodPickerSheet({ initialFrom, initialTo, onClose, onApply }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const fallback = todayDateOnly();
  const [from, setFrom] = useState(initialFrom || fallback);
  const [to, setTo] = useState(initialTo || fallback);

  const valid = from && to && from <= to;

  function apply() {
    if (!valid) return;
    haptic();
    onApply(from, to);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="period-picker-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Выбрать период</span>
          <div className="icon-button-spacer" />
        </div>

        <div className="period-picker-fields">
          <label className="period-picker-field">
            <span>С</span>
            <input
              type="date"
              value={from}
              max={to || fallback}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="period-picker-field">
            <span>По</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              max={fallback}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>

        <button className="sheet-close" disabled={!valid} onClick={apply}>
          Применить
        </button>
      </div>
    </div>
  );
}
