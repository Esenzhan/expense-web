import { getCategoryIcon } from "../categoryIcons";
import ExpenseRow from "./ExpenseRow";

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDateHeader(dateStr) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const weekday = date.toLocaleDateString("ru-RU", { weekday: "short" });
  const dayMonth = date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
  const base = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${dayMonth}`;

  if (sameDay(date, today)) return `${base} — Сегодня`;
  if (sameDay(date, yesterday)) return `${base} — Вчера`;
  return base;
}

function groupByDay(expenses) {
  const groups = [];
  let lastKey = null;
  for (const expense of expenses) {
    const key = new Date(expense.created_at).toDateString();
    if (key !== lastKey) {
      groups.push({ key, header: formatDateHeader(expense.created_at), items: [] });
      lastKey = key;
    }
    groups[groups.length - 1].items.push(expense);
  }
  return groups;
}

export default function ExpenseList({ expenses, onSelect, onDeleteRequest, currentUserId }) {
  const groups = groupByDay(expenses);

  return (
    <div>
      <p className="section-title">Последние траты</p>
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
