import { addDays, isWeekday, maxDate, minDate, monthBounds } from './dates.js';

/**
 * Pure billing calculation for one subscription in one month.
 *
 * Rules:
 *  - Tiffin is delivered Monday–Friday only.
 *  - The monthly plan price covers every weekday of the month.
 *  - The customer is billed only for weekdays inside their subscription window
 *    that are not covered by a pause.
 *  - amount = round(price * deliveredDays / workingDaysInMonth), in paise.
 *
 * @param {object} sub    { start_date, end_date|null, price_paise }
 * @param {Array}  pauses [{ start_date, end_date|null }]  (end inclusive; null = open)
 * @param {string} month  'YYYY-MM'
 */
export function computeBill(sub, pauses, month) {
  const { start: mStart, end: mEnd } = monthBounds(month);

  let workingDays = 0;
  for (let d = mStart; d <= mEnd; d = addDays(d, 1)) {
    if (isWeekday(d)) workingDays++;
  }

  const winStart = maxDate(sub.start_date, mStart);
  const winEnd = sub.end_date ? minDate(sub.end_date, mEnd) : mEnd;

  let subscribedDays = 0;
  let pausedDays = 0;
  let deliveredDays = 0;

  for (let d = winStart; d <= winEnd; d = addDays(d, 1)) {
    if (!isWeekday(d)) continue;
    subscribedDays++;
    const paused = pauses.some(
      (p) => p.start_date <= d && (p.end_date === null || p.end_date === undefined || d <= p.end_date)
    );
    if (paused) pausedDays++;
    else deliveredDays++;
  }

  const amountPaise = workingDays === 0 ? 0 : Math.round((sub.price_paise * deliveredDays) / workingDays);

  return {
    month,
    working_days: workingDays,
    subscribed_days: subscribedDays,
    paused_days: pausedDays,
    delivered_days: deliveredDays,
    price_paise: sub.price_paise,
    amount_paise: amountPaise,
  };
}

/** True if two date ranges (null end = open-ended) share at least one day. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const aE = aEnd ?? '9999-12-31';
  const bE = bEnd ?? '9999-12-31';
  return aStart <= bE && bStart <= aE;
}
