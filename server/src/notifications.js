import { isWeekday, parseDate } from './dates.js';

/**
 * Notification Service.
 *
 * Every outgoing customer message goes through `send()`. In this project the
 * transport is an outbox table (visible at GET /outbox) – swapping in a real
 * SMS/WhatsApp provider only means delivering rows from here. A `dedupe_key`
 * makes sends idempotent, so re-running a job never double-messages anyone.
 */
export function createNotificationService(db) {
  const insert = db.prepare(`
    INSERT INTO outbox (owner_id, customer_id, subscription_id, channel, recipient, type, for_date, message, dedupe_key)
    VALUES (@owner_id, @customer_id, @subscription_id, @channel, @recipient, @type, @for_date, @message, @dedupe_key)
    ON CONFLICT (dedupe_key) DO NOTHING`);

  return {
    /** Queue a message. Returns true if sent, false if it was a duplicate. */
    send({ owner_id = null, customer_id = null, subscription_id = null, channel = 'sms', recipient, type, for_date = null, message, dedupe_key = null }) {
      if (!recipient || !type || !message) throw new Error('Notification needs recipient, type and message');
      const { changes } = insert.run({ owner_id, customer_id, subscription_id, channel, recipient, type, for_date, message, dedupe_key });
      return changes === 1;
    },
  };
}

const prettyDate = (s) =>
  parseDate(s).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Customers due a delivery on `date`: subscription running that day, the day
 * is a weekday, and no pause covers it. Same rules as billing and status.
 */
export function customersDueOn(db, date) {
  if (!isWeekday(date)) return [];
  return db.prepare(`
    SELECT s.id AS subscription_id, c.id AS customer_id, c.owner_id, c.name, c.phone,
           pl.name AS plan_name, u.business_name
    FROM subscriptions s
    JOIN customers c ON c.id = s.customer_id
    JOIN plans pl ON pl.id = s.plan_id
    JOIN users u ON u.id = c.owner_id
    WHERE s.start_date <= @d AND (s.end_date IS NULL OR s.end_date >= @d)
      AND NOT EXISTS (
        SELECT 1 FROM pauses p WHERE p.subscription_id = s.id
          AND p.start_date <= @d AND (p.end_date IS NULL OR p.end_date >= @d))
    ORDER BY c.owner_id, c.name`).all({ d: date });
}

/** The morning job: notify everyone due a delivery on `date`. Idempotent per day. */
export function runMorningNotifications(db, date, notifier = createNotificationService(db)) {
  const due = customersDueOn(db, date);
  let notified = 0;
  for (const row of due) {
    const firstName = row.name.split(/\s+/)[0];
    const sent = notifier.send({
      owner_id: row.owner_id,
      customer_id: row.customer_id,
      subscription_id: row.subscription_id,
      recipient: row.phone,
      type: 'delivery_due',
      for_date: date,
      message: `Hi ${firstName}, your ${row.plan_name} tiffin from ${row.business_name || 'your tiffin service'} will be delivered today (${prettyDate(date)}).`,
      dedupe_key: `delivery_due:${row.subscription_id}:${date}`,
    });
    if (sent) notified++;
  }
  db.prepare(`
    INSERT INTO clock_runs (date, due, notified) VALUES (?, ?, ?)
    ON CONFLICT (date) DO UPDATE SET due = excluded.due, notified = clock_runs.notified + excluded.notified, ran_at = datetime('now')`)
    .run(date, due.length, notified);
  return { date, delivery_day: isWeekday(date), due: due.length, notified, already_notified: due.length - notified };
}
