// Date helpers. All dates are 'YYYY-MM-DD' strings handled in UTC so the
// server's timezone never shifts a day.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = parseDate(s);
  return formatDate(d) === s;
}

export function isValidMonth(s) {
  return typeof s === 'string' && MONTH_RE.test(s);
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDate(d);
}

export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const start = formatDate(new Date(Date.UTC(y, m - 1, 1)));
  const end = formatDate(new Date(Date.UTC(y, m, 0)));
  return { start, end };
}

export function isWeekday(s) {
  const day = parseDate(s).getUTCDay();
  return day !== 0 && day !== 6;
}

// Simulated "today" set through POST /clock. null = use the real date.
let clockOverride = null;
export function setClockOverride(date) {
  clockOverride = date || null;
}
export function getClockOverride() {
  return clockOverride;
}

/** Today's date, honouring the simulated clock when one is set. */
export function todayLocal() {
  return clockOverride ?? realToday();
}

export function realToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const maxDate = (a, b) => (a > b ? a : b);
export const minDate = (a, b) => (a < b ? a : b);
