// Астана/Алматы — UTC+5 круглый год, перехода на летнее время нет, так что
// фиксированного сдвига хватает и база часовых поясов не нужна. Сервер на
// Render живёт в UTC, поэтому локальные геттеры (getHours/getDate) и
// date_trunc(..., now()) дают −5 часов: любая граница суток или месяца,
// посчитанная без этого сдвига, съезжает на пять часов.
//
// Единственная копия сдвига на бэкенде — фронтенд держит свою в
// insights.js (там же periodRange, который считает ровно эти же границы
// месяца). Границы обязаны совпадать один в один: «Расходы» на главном
// экране считает фронт, а тот же месяц в /api/stats считает бэк, и разъезд
// между ними пользователь видит как два разных числа за один период.
export const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

// Тот же момент времени, сдвинутый так, что UTC-геттеры (getUTC*) отдают
// астанинские дату и час.
export function almaty(date = new Date()) {
  return new Date(date.getTime() + ALMATY_OFFSET_MS);
}

// «Сегодня» по Астане, YYYY-MM-DD.
export function almatyDateString(date = new Date()) {
  return almaty(date).toISOString().slice(0, 10);
}

// Дата, время и день недели по Астане. weekday в ISO-нумерации (1=Пн..7=Вс),
// как в reminder_settings.days и как в «Первый день недели: Понедельник».
export function almatyNow(date = new Date()) {
  const shifted = almaty(date);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: shifted.toISOString().slice(0, 10),
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    weekday: shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay(),
  };
}

// Начало и конец текущего АСТАНИНСКОГО календарного месяца как настоящие
// моменты времени (timestamptz-совместимые), пригодные прямо в SQL-параметры.
// Зеркалит ветку "month" во фронтовом periodRange (insights.js).
export function almatyMonthRange(now = new Date()) {
  const a = almaty(now);
  return {
    start: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1) - ALMATY_OFFSET_MS),
    end: new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1) - ALMATY_OFFSET_MS),
  };
}
