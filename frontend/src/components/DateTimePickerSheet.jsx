import { useRef, useState } from "react";
import { useSwipeDismiss } from "../sheetGestures";
import { haptic } from "../haptics";

function pad(n) {
  return String(n).padStart(2, "0");
}
function toDateValue(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeValue(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Backdates a manually added expense — opened from the calendar button on
// EditExpenseSheet's add-expense header. Picking a day/time here and hitting
// "Подтвердить" is what turns into the request's `created_at`; left
// untouched, the expense keeps recording at the exact save moment.
export default function DateTimePickerSheet({ initial, onClose, onApply }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const [date, setDate] = useState(toDateValue(initial));
  const [time, setTime] = useState(toTimeValue(initial));

  const todayValue = toDateValue(new Date());
  const valid = Boolean(date && time);

  function apply() {
    if (!valid) return;
    haptic();
    onApply(new Date(`${date}T${time}:00`));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="period-picker-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Дата и время</span>
          <div className="icon-button-spacer" />
        </div>

        <div className="period-picker-fields">
          <label className="period-picker-field">
            <span>Дата</span>
            <input
              type="date"
              value={date}
              max={todayValue}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="period-picker-field">
            <span>Время</span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>

        <div className="confirm-actions">
          <button className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" disabled={!valid} onClick={apply}>
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}
