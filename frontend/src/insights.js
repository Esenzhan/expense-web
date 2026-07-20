// Pure arithmetic over expense rows — ported from the backend's
// computeInsights.js so the Insights sheet can be computed entirely
// client-side: instant to open (no network round trip) and correct offline,
// since it only ever needs whatever expense rows are already cached locally.
// Day bucketing uses a fixed Asia/Almaty (UTC+5) offset so "today"/"yesterday"
// match the user's phone regardless of the device's own timezone.
const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

function almaty(date) {
  return new Date(date.getTime() + ALMATY_OFFSET_MS);
}

function startOfAlmatyDay(date) {
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

export function periodRange(period, now = new Date()) {
  if (period === "month") {
    const a = almaty(now);
    const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) - ALMATY_OFFSET_MS);
    const end = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1) - ALMATY_OFFSET_MS);
    const prevEnd = start;
    const prevStart = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1) - ALMATY_OFFSET_MS);
    const daysInPeriod = Math.round((end - start) / 86400000);
    return { start, end, prevStart, prevEnd, daysInPeriod };
  }
  const days = Number(period) || 30;
  const end = addDays(startOfAlmatyDay(now), 1);
  const start = addDays(end, -days);
  const prevEnd = start;
  const prevStart = addDays(start, -days);
  return { start, end, prevStart, prevEnd, daysInPeriod: days };
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

  const avgPerDay = daysInPeriod > 0 ? total / daysInPeriod : 0;

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
      ? { category: biggestExpense.category, amount: Number(biggestExpense.amount) }
      : null,
    mostExpensiveDay: mostExpensiveDayResult,
    noSpendStreak,
    weekendPercent,
    transactionCount,
  };
}
