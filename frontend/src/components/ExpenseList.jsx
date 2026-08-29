import { useState } from "react";
import { getCategoryIcon, getIncomeCategoryIcon } from "../categoryIcons";
import { almaty, startOfAlmatyDay } from "../insights";
import { haptic, withHaptic } from "../haptics";
import ExpenseRow from "./ExpenseRow";
import CategoryGlyph from "./CategoryGlyph";
import CategoryFilterDropdown from "./CategoryFilterDropdown";
import { catIconVars } from "../catIconVars";

function FilterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16l-6.5 7.5v6L10.5 21v-8.5L4 5Z" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

// Both the header label and the day-bucket grouping below are anchored to
// Asia/Almaty (like everywhere else in insights.js) rather than the
// device's own timezone — otherwise a device set to a different timezone
// would group/label rows into a different day than the period pills and
// Insights sheet agree "today" is.
export function formatDateHeader(dateStr) {
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
  categoryFilterOptions,
  categoryFilter,
  onCategoryFilterChange,
  categoryFilterActive,
}) {
  const groups = groupByDay(expenses);
  const selectedFilterIcon = categoryFilter
    ? categoryFilterOptions?.find((c) => c.key === categoryFilter)?.icon
    : null;
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div>
      <div className="section-title-row">
        <p className="section-title">Последние траты</p>
        <div className="list-filters">
          {categoryFilterOptions?.length > 0 && (
            <div className="category-filter-wrap">
              <button
                className={`filter-pill has-icon ${categoryFilter ? "active" : ""}`}
                onClick={() => {
                  haptic();
                  setDropdownOpen((v) => !v);
                }}
              >
                <span
                  className="category-icon filter-pill-icon"
                  style={selectedFilterIcon ? catIconVars(selectedFilterIcon.bg, selectedFilterIcon.fg) : undefined}
                >
                  {selectedFilterIcon ? <CategoryGlyph emoji={selectedFilterIcon.emoji} size={12} /> : <FilterIcon />}
                </span>
                <span>{categoryFilterOptions.find((c) => c.key === categoryFilter)?.name || "Категория"}</span>
              </button>
              {dropdownOpen && (
                <CategoryFilterDropdown
                  expenseCategories={categoryFilterOptions.filter((c) => c.type !== "income")}
                  incomeCategories={categoryFilterOptions.filter((c) => c.type === "income")}
                  selected={categoryFilter}
                  onSelect={onCategoryFilterChange}
                  onClose={() => setDropdownOpen(false)}
                />
              )}
            </div>
          )}
          {/* Same pill as the category filter — on/off reads from the fill, the
              way the period pills above already work, instead of this being a
              bare label with a miniature iOS switch glued to it. */}
          {showMineToggle && (
            <button
              className={`filter-pill ${onlyMine ? "active" : ""}`}
              onClick={withHaptic(onToggleOnlyMine)}
              aria-pressed={onlyMine}
            >
              <PersonIcon />
              <span>Только мои</span>
            </button>
          )}
        </div>
      </div>
      {expenses.length === 0 && (
        <p className="empty-hint">
          {categoryFilterActive
            ? "В этой категории пока пусто."
            : "Пока пусто — скажи что-нибудь вроде «500 на такси»."}
        </p>
      )}
      {groups.map((group) => (
        <div className="expense-group" key={group.key}>
          <p className="expense-date-header">{group.header}</p>
          <div className="expense-list">
            {group.items.map((expense) => {
              const icon =
                expense.type === "income"
                  ? getIncomeCategoryIcon(expense.wallet, expense.category)
                  : getCategoryIcon(expense.wallet, expense.category);
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
