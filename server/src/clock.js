import { addDays, getClockOverride, isValidDate, realToday, setClockOverride, todayLocal } from './dates.js';
import { runMorningNotifications } from './notifications.js';
import { badRequest } from './http.js';

const MAX_MORNINGS = 366;

/** Restore a previously set simulated date when the server starts. */
export function loadClock(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'clock_date'").get();
  setClockOverride(row?.value && isValidDate(row.value) ? row.value : null);
}

export function clockState() {
  return { today: todayLocal(), simulated: getClockOverride() !== null, real_today: realToday() };
}

function persist(db, date) {
  if (date) db.prepare("INSERT INTO settings (key, value) VALUES ('clock_date', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(date);
  else db.prepare("DELETE FROM settings WHERE key = 'clock_date'").run();
  setClockOverride(date);
}

/**
 * POST /clock. Moves the simulated clock and runs the morning job.
 *
 *  {}                        → run this morning's job again (no time change)
 *  { "date": "2026-09-21" }  → jump to that date (also accepts "now": ISO datetime)
 *  { "advance_days": 3 }     → move forward N days (alias: "days")
 *  { "reset": true }         → return to the real date (no job run)
 *
 * Moving forward runs every morning passed through, in order, so skipping
 * ahead a few days never skips anyone's reminder. Moving backwards (or to the
 * same day) runs only the target morning. Re-runs never duplicate messages.
 */
export function tickClock(db, body = {}) {
  const from = todayLocal();

  if (body.reset === true) {
    persist(db, null);
    return { ...clockState(), from, mornings: [], notified_total: 0 };
  }

  let target = from;
  if (body.date !== undefined || body.now !== undefined) {
    const raw = String(body.date ?? body.now).slice(0, 10);
    if (!isValidDate(raw)) throw badRequest('date must be YYYY-MM-DD (or now: an ISO datetime)');
    target = raw;
  } else if (body.advance_days !== undefined || body.days !== undefined) {
    const n = Number(body.advance_days ?? body.days);
    if (!Number.isInteger(n) || n < 0 || n > MAX_MORNINGS) throw badRequest(`advance_days must be a whole number from 0 to ${MAX_MORNINGS}`);
    target = addDays(from, n);
  }

  let days = [target];
  if (target > from) {
    days = [];
    for (let d = addDays(from, 1); d <= target; d = addDays(d, 1)) days.push(d);
    if (days.length > MAX_MORNINGS) throw badRequest(`Cannot advance more than ${MAX_MORNINGS} days at once`);
  }

  persist(db, target);
  const mornings = days.map((d) => runMorningNotifications(db, d));
  return { ...clockState(), from, mornings, notified_total: mornings.reduce((n, m) => n + m.notified, 0) };
}
