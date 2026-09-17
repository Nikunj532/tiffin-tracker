import { Router } from 'express';
import { badRequest, h, pageParams, paged, str } from '../http.js';
import { isValidMonth, monthBounds, todayLocal } from '../dates.js';
import { computeBill } from '../billing.js';
import { tx } from '../db.js';

const SORTABLE = {
  name: 'c.name COLLATE NOCASE',
  phone: 'c.phone',
  amount: 'b.amount_paise',
  delivered: 'b.delivered_days',
  paused: 'b.paused_days',
  plan: 'pl.name COLLATE NOCASE',
};

export default function billRoutes(db) {
  const r = Router();

  const monthParam = (v) => {
    const month = v || todayLocal().slice(0, 7);
    if (!isValidMonth(month)) throw badRequest('month must be YYYY-MM');
    return month;
  };

  /** Subscriptions of this owner that overlap the month at all. */
  const subsInMonth = (owner, month) => {
    const { start, end } = monthBounds(month);
    return db.prepare(`
      SELECT s.* FROM subscriptions s JOIN customers c ON c.id = s.customer_id
      WHERE c.owner_id = ? AND s.start_date <= ? AND (s.end_date IS NULL OR s.end_date >= ?)`).all(owner, end, start);
  };

  // POST /api/bills/generate  { month }  – (re)compute and save bills for everyone
  r.post('/generate', h((req, res) => {
    const month = monthParam(req.body.month);
    const subs = subsInMonth(req.userId, month);
    const pausesOf = db.prepare('SELECT start_date, end_date FROM pauses WHERE subscription_id = ?');
    const upsert = db.prepare(`
      INSERT INTO bills (subscription_id, month, working_days, subscribed_days, paused_days, delivered_days, price_paise, amount_paise)
      VALUES (@subscription_id, @month, @working_days, @subscribed_days, @paused_days, @delivered_days, @price_paise, @amount_paise)
      ON CONFLICT (subscription_id, month) DO UPDATE SET
        working_days = excluded.working_days, subscribed_days = excluded.subscribed_days,
        paused_days = excluded.paused_days, delivered_days = excluded.delivered_days,
        price_paise = excluded.price_paise, amount_paise = excluded.amount_paise,
        generated_at = datetime('now')`);

    let totalPaise = 0;
    tx(db, () => {
      // Drop stale bills for subscriptions that no longer overlap this month.
      db.prepare(`
        DELETE FROM bills WHERE month = ? AND subscription_id IN (
          SELECT s.id FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE c.owner_id = ?)`).run(month, req.userId);
      for (const sub of subs) {
        const bill = computeBill(sub, pausesOf.all(sub.id), month);
        upsert.run({ subscription_id: sub.id, ...bill });
        totalPaise += bill.amount_paise;
      }
    });
    res.json({ month, bills_generated: subs.length, total_amount_paise: totalPaise });
  }));

  // GET /api/bills?month=&search=&page=&limit=&sort=&order=
  r.get('/', h((req, res) => {
    const month = monthParam(req.query.month);
    const p = pageParams(req.query, SORTABLE, 'name');
    const q = `%${str(req.query.search)}%`;
    const from = `
      FROM bills b
      JOIN subscriptions s ON s.id = b.subscription_id
      JOIN customers c ON c.id = s.customer_id
      JOIN plans pl ON pl.id = s.plan_id
      WHERE c.owner_id = ? AND b.month = ? AND (c.name LIKE ? OR c.phone LIKE ?)`;
    const args = [req.userId, month, q, q];

    const summary = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(b.amount_paise), 0) AS total,
      COALESCE(SUM(b.delivered_days), 0) AS delivered, COALESCE(SUM(b.paused_days), 0) AS paused ${from}`).get(...args);
    const rows = db.prepare(`
      SELECT b.*, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, pl.name AS plan_name,
        s.start_date, s.end_date,
        (SELECT fc.name FROM subscriptions fs JOIN customers fc ON fc.id = fs.customer_id WHERE fs.id = s.transferred_from_id) AS transferred_from_name,
        (SELECT tc.name FROM subscriptions ts JOIN customers tc ON tc.id = ts.customer_id WHERE ts.transferred_from_id = s.id) AS transferred_to_name
      ${from} ORDER BY ${p.orderBy}, b.id LIMIT ? OFFSET ?`).all(...args, p.limit, p.offset);
    const lastGenerated = db.prepare(`SELECT MAX(b.generated_at) AS at ${from}`).get(...args).at;

    res.json({
      ...paged(rows, summary.n, p),
      month,
      summary: { total_amount_paise: summary.total, delivered_days: summary.delivered, paused_days: summary.paused },
      generated_at: lastGenerated,
    });
  }));

  return r;
}
