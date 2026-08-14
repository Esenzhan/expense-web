// Pure arithmetic over expense rows — ported from the backend's
// computeInsights.js so the Insights sheet can be computed entirely
// client-side: instant to open (no network round trip) and correct offline,
// since it only ever needs whatever expense rows are already cached locally.
// Day bucketing uses a fixed Asia/Almaty (UTC+5) offset so "today"/"yesterday"
// match the user's phone regardless of the device's own timezone.
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function almaty(date) {
  return new Date(date.getTime() + ALMATY_OFFSET_MS);
}

export function startOfAlmatyDay(date) {
  const a = almaty(date);
  return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) - ALMATY_OFFSET_MS);
}

function addDays(date, n) {
  return new Date(date.getTime() + n * 86400000);
}

function formatDayLabel(date, today) {
  const diffDays = Math.round((startOfAlmatyDay(today) - startOfAlmatyDay(date)) / 86400000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  return almaty(date).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

// "custom:YYYY-MM-DD:YYYY-MM-DD" (from/to are inclusive Almaty calendar days)
// is how a user-picked range is encoded into the same `period` string used
// everywhere else, so it flows through caching/props without a second prop.
export function periodRange(period, now = new Date()) {
  if (period === "today") {
    const start = startOfAlmatyDay(now);
    const end = addDays(start, 1);
    return { start, end, prevStart: addDays(start, -1), prevEnd: start, daysInPeriod: 1 };
  }
  if (typeof period === "string" && period.startsWith("custom:")) {
    const [, fromStr, toStr] = period.split(":");
    const start = startOfAlmatyDay(new Date(fromStr));
    const end = addDays(startOfAlmatyDay(new Date(toStr)), 1);
    const spanMs = end - start;
    return {
      start,
      end,
      prevStart: new Date(start.getTime() - spanMs),
      prevEnd: start,
      daysInPeriod: Math.round(spanMs / 86400000),
    };
  }
  // "month" and any unrecognized value fall back to the current calendar month
  const a = almaty(now);
  const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) - ALMATY_OFFSET_MS);
  const end = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1) - ALMATY_OFFSET_MS);
  const prevEnd = start;
  const prevStart = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1) - ALMATY_OFFSET_MS);
  const daysInPeriod = Math.round((end - start) / 86400000);
  return { start, end, prevStart, prevEnd, daysInPeriod };
}

const MONTH_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function shortDateLabel(dateOnlyStr) {
  const [, m, d] = dateOnlyStr.split("-").map(Number);
  return `${d} ${MONTH_SHORT[m - 1]}`;
}

// Human label for a `period` string — used on both the main screen's pill
// and the Insights sheet, so the two never drift apart.
export function formatPeriodLabel(period) {
  if (period === "today") return "Сегодня";
  if (typeof period === "string" && period.startsWith("custom:")) {
    const [, fromStr, toStr] = period.split(":");
    return fromStr === toStr ? shortDateLabel(fromStr) : `${shortDateLabel(fromStr)} – ${shortDateLabel(toStr)}`;
  }
  return "Этот месяц";
}

export function computeInsights({ period, rows, previousTotal = 0, now = new Date() }) {
  const { start, end, daysInPeriod } = periodRange(period, now);
  const today = now < end ? now : addDays(end, -1);
  const todayIndex = Math.min(
    daysInPeriod,
    Math.round((startOfAlmatyDay(today) - startOfAlmatyDay(start)) / 86400000) + 1
  );

  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const transactionCount = rows.length;

  // Spend per category within the period — used for the per-category limit
  // progress bars (limits themselves live server-side, see
  // /api/category-limits; this is just "how much of it is spent so far").
  const categoryTotals = {};
  for (const row of rows) {
    categoryTotals[row.category] = (categoryTotals[row.category] || 0) + Number(row.amount);
  }

  // Per-day totals, keyed by day offset within the period (1-based).
  const dayTotals = new Map();
  for (const row of rows) {
    const offset = Math.round((startOfAlmatyDay(new Date(row.created_at)) - startOfAlmatyDay(start)) / 86400000) + 1;
    dayTotals.set(offset, (dayTotals.get(offset) || 0) + Number(row.amount));
  }

  const series = [];
  let running = 0;
  for (let day = 1; day <= todayIndex; day++) {
    running += dayTotals.get(day) || 0;
    series.push({ day, cumulative: running });
  }

  // Divided by days elapsed so far, not the full period length — for the
  // current month that's days-from-the-1st-to-today, not all 30/31 days,
  // so the average reflects the actual pace rather than being diluted by
  // days that haven't happened yet.
  const avgPerDay = todayIndex > 0 ? total / todayIndex : 0;

  let biggestExpense = null;
  for (const row of rows) {
    if (!biggestExpense || Number(row.amount) > Number(biggestExpense.amount)) biggestExpense = row;
  }

  let mostExpensiveDay = null;
  for (const [offset, amount] of dayTotals) {
    if (!mostExpensiveDay || amount > mostExpensiveDay.amount) {
      mostExpensiveDay = { offset, amount };
    }
  }
  const mostExpensiveDayResult = mostExpensiveDay
    ? {
        label: formatDayLabel(addDays(start, mostExpensiveDay.offset - 1), now),
        amount: mostExpensiveDay.amount,
      }
    : null;

  // Consecutive zero-spend days ending yesterday, bounded by the period start.
  let noSpendDays = 0;
  const yesterdayOffset = todayIndex - 1;
  for (let offset = yesterdayOffset; offset >= 1; offset--) {
    if (dayTotals.get(offset)) break;
    noSpendDays++;
  }
  const noSpendStreak =
    noSpendDays > 0
      ? {
          days: noSpendDays,
          fromLabel: formatDayLabel(addDays(start, yesterdayOffset - noSpendDays), now),
          toLabel: formatDayLabel(addDays(start, yesterdayOffset - 1), now),
        }
      : null;

  let weekendTotal = 0;
  for (const row of rows) {
    const weekday = almaty(new Date(row.created_at)).getUTCDay(); // 0 = Sun, 6 = Sat
    if (weekday === 0 || weekday === 6) weekendTotal += Number(row.amount);
  }
  const weekendPercent = total > 0 ? Math.round((weekendTotal / total) * 100) : 0;

  return {
    total,
    daysInPeriod,
    todayIndex,
    series,
    previousPeriodTotal: previousTotal,
    avgPerDay,
    biggestExpense: biggestExpense
      ? { category: biggestExpense.category, wallet: biggestExpense.wallet, amount: Number(biggestExpense.amount) }
      : null,
    mostExpensiveDay: mostExpensiveDayResult,
    noSpendStreak,
    weekendPercent,
    transactionCount,
    categoryTotals,
  };
}
