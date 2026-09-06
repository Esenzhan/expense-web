import { useLayoutEffect, useRef, useState } from "react";
import { useSwipeDismiss } from "../sheetGestures";
import { haptic, withHaptic } from "../haptics";
import { almaty, monthLabel, monthRangeStrings } from "../insights";

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

// Сколько месяцев назад предлагать одним нажатием.
const MONTHS_BACK = 12;

// Текущий месяц и одиннадцать предыдущих — по астанинскому календарю, как и
// всё остальное в приложении: под утро первого числа месяц на телефоне в
// другом поясе был бы уже (или ещё) не тот.
//
// По времени слева направо, как читают: старый месяц слева, текущий —
// крайний справа. Ряд при открытии домотан до конца (см. useLayoutEffect
// ниже), так что видно сразу текущий и пару предыдущих — те, за которыми
// сюда и приходят.
function recentMonths(now = new Date()) {
  const a = almaty(now);
  const months = [];
  for (let back = MONTHS_BACK - 1; back >= 0; back--) {
    const point = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - back, 1));
    months.push({ year: point.getUTCFullYear(), month: point.getUTCMonth() });
  }
  return months;
}

// Custom "От — До" range for the main screen's period toggle. Dates are
// plain YYYY-MM-DD (no time) — periodRange() in insights.js treats them as
// inclusive Almaty calendar days. Neither end is capped at today: expenses
// and income can be recorded on future dates (DateTimePickerSheet), so a
// range must be able to reach them.
export default function PeriodPickerSheet({ initialFrom, initialTo, onClose, onApply }) {
  const sheetRef = useRef(null);
  useSwipeDismiss(sheetRef, onClose);

  const fallback = todayDateOnly();
  const [from, setFrom] = useState(initialFrom || fallback);
  const [to, setTo] = useState(initialTo || fallback);

  const valid = from && to && from <= to;
  const months = recentMonths();

  // Домотать ряд месяцев вправо, к текущему. useLayoutEffect, а не
  // useEffect: сдвиг применяется до отрисовки, иначе видно, как ряд
  // прыгает с прошлогоднего октября на сентябрь.
  const monthsRef = useRef(null);
  useLayoutEffect(() => {
    const row = monthsRef.current;
    if (row) row.scrollLeft = row.scrollWidth;
  }, []);

  function apply() {
    if (!valid) return;
    haptic();
    onApply(from, to);
  }

  // Месяц целиком — одним нажатием, без двух календарей: за этим сюда и
  // приходят («посмотреть за август»). Границы обязаны быть ровно первым и
  // последним числом — по ним Инсайты понимают, что период это месяц, и
  // показывают лимиты (см. fullMonthOf в insights.js).
  function applyMonth({ year, month }) {
    const range = monthRangeStrings(year, month);
    setFrom(range.from);
    setTo(range.to);
    haptic();
    onApply(range.from, range.to);
  }

  return (
    <div className="sheet-backdrop" onClick={withHaptic(onClose)}>
      <div className="period-picker-sheet" ref={sheetRef} onClick={(event) => event.stopPropagation()}>
        <div className="cats-header">
          <button className="icon-button" onClick={withHaptic(onClose)} aria-label="Закрыть">
            ✕
          </button>
          <span className="cats-title">Выбрать период</span>
          <div className="icon-button-spacer" />
        </div>

        <p className="newcat-group-title">Месяц целиком</p>
        <div className="period-month-row" ref={monthsRef}>
          {months.map((m) => {
            const range = monthRangeStrings(m.year, m.month);
            const active = from === range.from && to === range.to;
            return (
              <button
                key={`${m.year}-${m.month}`}
                type="button"
                className={`period-pill ${active ? "active" : ""}`}
                onClick={() => applyMonth(m)}
              >
                {monthLabel(m.year, m.month)}
              </button>
            );
          })}
        </div>

        <p className="newcat-group-title">Свой период</p>
        <div className="period-picker-fields">
          <label className="period-picker-field">
            <span>С</span>
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="period-picker-field">
            <span>По</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
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
