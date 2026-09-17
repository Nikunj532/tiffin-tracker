import { Router } from 'express';
import { h } from '../http.js';
import { computeBill } from '../billing.js';
import { isWeekday, monthBounds } from '../dates.js';
import { asOf, STATUS_SQL } from './customers.js';

export default function dashboardRoutes(db) {
  const r = Router();

  // GET /api/dashboard?as_of=YYYY-MM-DD
  r.get('/', h((req, res) => {
    const t = asOf(req.query);
    const owner = req.userId;
    const month = t.slice(0, 7);

    const counts = { active: 0, paused: 0, upcoming: 0, inactive: 0 };
    for (const row of db.prepare(`SELECT status, COUNT(*) AS n FROM (SELECT ${STATUS_SQL} AS status FROM customers c WHERE c.owner_id = @owner) GROUP BY status`).all({ owner, t })) {
      counts[row.status] = row.n;
    }

    // Projected month-to-date revenue from live data (not saved bills).
    const { start, end } = monthBounds(month);
    const subs = db.prepare(`
      SELECT s.* FROM subscriptions s JOIN customers c ON c.id = s.customer_id
      WHERE c.owner_id = ? AND s.start_date <= ? AND (s.end_date IS NULL OR s.end_date >= ?)`).all(owner, end, start);
    const pausesOf = db.prepare('SELECT start_date, end_date FROM pauses WHERE subscription_id = ?');
    let projected = 0;
    for (const s of subs) projected += computeBill(s, pausesOf.all(s.id), month).amount_paise;

    const pausedToday = db.prepare(`
      SELECT c.id, c.name, c.phone, p.start_date, p.end_date, p.reason
      FROM pauses p JOIN subscriptions s ON s.id = p.subscription_id JOIN customers c ON c.id = s.customer_id
      WHERE c.owner_id = ? AND p.start_date <= ? AND (p.end_date IS NULL OR p.end_date >= ?)
        AND s.start_date <= ? AND (s.end_date IS NULL OR s.end_date >= ?)
      ORDER BY p.end_date IS NULL, p.end_date LIMIT 10`).all(owner, t, t, t, t);

    const plans = db.prepare('SELECT COUNT(*) AS n FROM plans WHERE owner_id = ?').get(owner).n;

    res.json({
      as_of: t,
      month,
      is_delivery_day: isWeekday(t),
      meals_today: isWeekday(t) ? counts.active : 0,
      counts,
      total_customers: Object.values(counts).reduce((a, b) => a + b, 0),
      plans,
      projected_month_revenue_paise: projected,
      paused_today: pausedToday,
    });
  }));

  return r;
}
