import { getCategoryIcon } from "../categoryIcons";
import { almaty, startOfAlmatyDay } from "../insights";
import ExpenseRow from "./ExpenseRow";

// Both the header label and the day-bucket grouping below are anchored to
// Asia/Almaty (like everywhere else in insights.js) rather than the
// device's own timezone — otherwise a device set to a different timezone
// would group/label rows into a different day than the period pills and
// Insights sheet agree "today" is.
function formatDateHeader(dateStr) {
  const date = new Date(dateStr);
  const diffDays = Math.round((startOfAlmatyDay(new Date()) - startOfAlmatyDay(date)) / 86400000);

  const shifted = almaty(date);
  const weekday = shifted.toLocaleDateString("ru-RU", { weekday: "short", timeZone: "UTC" });
  const dayMonth = shifted.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", timeZone: "UTC" });
  const base = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`;

  if (diffDays === 0) return `${base} — Сегодня`;
  if (diffDays === 1) return `${base} — Вчера`;
  return base;
}

function groupByDay(expenses) {
  const groups = [];
  let lastKey = null;
  for (const expense of expenses) {
    const key = startOfAlmatyDay(new Date(expense.created_at)).toISOString();
    if (key !== lastKey) {
      groups.push({ key, header: formatDateHeader(expense.created_at), items: [] });
      lastKey = key;
    }
    groups[groups.length - 1].items.push(expense);
  }
  return groups;
}

export default function ExpenseList({
  expenses,
  onSelect,
  onDeleteRequest,
  currentUserId,
  showMineToggle,
  onlyMine,
  onToggleOnlyMine,
}) {
  const groups = groupByDay(expenses);

  return (
    <div>
      <div className="section-title-row">
        <p className="section-title">Последние траты</p>
        {showMineToggle && (
          <button className="mine-toggle" onClick={onToggleOnlyMine}>
            <span>Только мои</span>
            <span className={`switch switch-sm ${onlyMine ? "on" : ""}`}>
              <span className="switch-knob" />
            </span>
          </button>
        )}
      </div>
      {expenses.length === 0 && (
        <p className="empty-hint">Пока пусто — скажи что-нибудь вроде «500 на такси».</p>
      )}
      {groups.map((group) => (
        <div className="expense-group" key={group.key}>
          <p className="expense-date-header">{group.header}</p>
          <div className="expense-list">
            {group.items.map((expense) => {
              const icon = getCategoryIcon(expense.wallet, expense.category);
              // Shared-wallet rows from the other account are visible but
              // read-only — only whoever logged an expense can edit/delete it.
              const readonly = expense.user_id != null && expense.user_id !== currentUserId;
              return (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  icon={icon}
                  readonly={readonly}
                  onSelect={onSelect}
                  onDeleteRequest={onDeleteRequest}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
