import { useRef, useState } from "react";
import { useSwipeDismiss } from "../sheetGestures";
import { haptic, hapticTick } from "../haptics";

const WEEKDAYS = ["ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ", "ВС"];

function pad(n) {
  return String(n).padStart(2, "0");
}
function toTimeValue(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
function sameDay(a, b) {
  return sameMonth(a, b) && a.getDate() === b.getDate();
}
function monthLabel(d) {
  const label = d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
// Monday-first grid: null placeholders fill the leading gap before day 1,
// same as the reference — no trailing-month numbers padded onto the tail.
function buildMonthCells(viewMonth) {
  const leadBlanks = (startOfMonth(viewMonth).getDay() + 6) % 7;
  const daysCount = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const cells = Array(leadBlanks).fill(null);
  for (let day = 1; day <= daysCount; day++) cells.push(day);
  return cells;
}

// Backdates a manually added expense — opened from the calendar button on
// EditExpenseSheet's add-expense header. Picking a day/time here and hitting
// "Подтвердить" is what turns into the request's `created_at`; left
// untouched, the expense keeps recording at the exact save moment.
export default function DateTimePickerSheet({ initial, onClose, onApply }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(initial));
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(initial));
  const [time, setTime] = useState(toTimeValue(initial));

  const atCurrentMonth = sameMonth(viewMonth, today);
  const cells = buildMonthCells(viewMonth);

  function pickDay(day) {
    const picked = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
    if (picked > today) return;
    hapticTick();
    setSelectedDay(picked);
  }

  function shiftMonth(delta) {
    if (delta > 0 && atCurrentMonth) return;
    haptic();
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  function apply() {
    haptic();
    const [h, m] = time.split(":").map(Number);
    const result = new Date(selectedDay);
    result.setHours(h || 0, m || 0, 0, 0);
    onApply(result);
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="period-picker-sheet dt-picker-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="dt-cal-header">
          <span className="dt-cal-month">{monthLabel(viewMonth)}</span>
          <div className="dt-cal-nav">
            <button className="dt-cal-nav-btn" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
              ‹
            </button>
            <button
              className="dt-cal-nav-btn"
              onClick={() => shiftMonth(1)}
              disabled={atCurrentMonth}
              aria-label="Следующий месяц"
            >
              ›
            </button>
          </div>
        </div>

        <div className="dt-weekdays">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="dt-grid">
          {cells.map((day, index) => {
            if (day == null) return <span className="dt-day-empty" key={`b${index}`} />;
            const cellDate = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
            const future = cellDate > today;
            return (
              <button
                key={day}
                className={`dt-day ${sameDay(cellDate, selectedDay) ? "selected" : ""} ${future ? "disabled" : ""}`}
                onClick={() => pickDay(day)}
                disabled={future}
              >
                {day}
              </button>
            );
          })}
        </div>

        <label className="balance-row dt-time-row">
          <span className="balance-label">Время</span>
          <input
            type="time"
            className="dt-time-input"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>

        <div className="confirm-actions">
          <button className="btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn-primary" onClick={apply}>
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}
