import { startOfAlmatyDay } from "./insights";

// Same palette NewCategorySheet/NewWalletSheet offer for manual picking —
// here it's assigned automatically from a hash of the name, so the same
// counterparty always lands on the same color across snapshots without
// anyone having to pick one.
const PALETTE = [
  { bg: "#e9e9ec", fg: "#3a3a40" },
  { bg: "#fde2e1", fg: "#c23b3b" },
  { bg: "#ffe6d1", fg: "#c2681f" },
  { bg: "#fff2cf", fg: "#a9790a" },
  { bg: "#ecf7d4", fg: "#5f8f1f" },
  { bg: "#e1f3e3", fg: "#2f8f4e" },
  { bg: "#d8f5f1", fg: "#1f9e8c" },
  { bg: "#dff0fb", fg: "#1f7fae" },
  { bg: "#e3ecfd", fg: "#2f5fc2" },
  { bg: "#eee3fd", fg: "#7440c2" },
  { bg: "#fde1ef", fg: "#c23b8f" },
  { bg: "#ece3d8", fg: "#8a6a3f" },
];

export function avatarColorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function avatarInitial(name) {
  return (name.trim()[0] || "?").toUpperCase();
}

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

// due_date is a plain DATE column (see DebtDetailSheet's comment) — always
// UTC midnight of that calendar date, no time-of-day to shift.
export function formatDueDate(dueDate) {
  const d = new Date(dueDate);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// null when the debt isn't overdue (no due date, not yet due, or already
// closed) — otherwise the days/months elapsed since due_date, for both the
// "N дней/мес" label text and the overdue count in the hero chip.
export function overdueDays(debt) {
  if (!debt.due_date || debt.status !== "open") return null;
  const due = new Date(debt.due_date);
  const dueStart = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const today = startOfAlmatyDay(new Date()).getTime();
  const diffDays = Math.round((today - dueStart) / 86400000);
  return diffDays > 0 ? diffDays : null;
}

export function formatOverdue(days) {
  if (days < 35) return `Просрочено на ${days} ${pluralRu(days, "день", "дня", "дней")}`;
  const months = Math.max(1, Math.round(days / 30.44));
  return `Просрочено на ${months} ${pluralRu(months, "месяц", "месяца", "месяцев")}`;
}
