import { Router } from 'express';
import { badRequest, h, HttpError, notFound, str } from '../http.js';
import { addDays, isValidDate, isValidMonth, todayLocal } from '../dates.js';
import { computeBill, rangesOverlap } from '../billing.js';
import { tx } from '../db.js';

export default function subscriptionRoutes(db) {
  const r = Router();

  const loadSub = (id, owner) => {
    const sub = db.prepare(`
      SELECT s.*, pl.name AS plan_name, c.name AS customer_name, c.phone AS customer_phone
      FROM subscriptions s
      JOIN customers c ON c.id = s.customer_id
      JOIN plans pl ON pl.id = s.plan_id
      WHERE s.id = ? AND c.owner_id = ?`).get(id, owner);
    if (!sub) throw notFound('Subscription');
    sub.pauses = db.prepare('SELECT * FROM pauses WHERE subscription_id = ? ORDER BY start_date').all(sub.id);
    return sub;
  };

  const dateOr = (v, fallback, field) => {
    if (v === undefined || v === null || v === '') return fallback;
    if (!isValidDate(v)) throw badRequest(`${field} must be a valid YYYY-MM-DD date`);
    return v;
  };

  // POST /api/customers/:customerId/subscriptions  { plan_id, start_date }
  r.post('/customers/:customerId/subscriptions', h((req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND owner_id = ?').get(req.params.customerId, req.userId);
    if (!customer) throw notFound('Customer');
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND owner_id = ?').get(req.body.plan_id, req.userId);
    if (!plan) throw badRequest('plan_id must reference one of your plans');
    if (!plan.is_active) throw badRequest('This plan is inactive');
    const start = dateOr(req.body.start_date, todayLocal(), 'start_date');

    // One running subscription per customer: anything not ended before start blocks a new one.
    const clash = db.prepare('SELECT id FROM subscriptions WHERE customer_id = ? AND (end_date IS NULL OR end_date >= ?)')
      .get(customer.id, start);
    if (clash) throw new HttpError(409, 'Customer already has a subscription running on or after this date. End it first.');

    const { lastInsertRowid } = db
      .prepare('INSERT INTO subscriptions (customer_id, plan_id, price_paise, start_date) VALUES (?, ?, ?, ?)')
      .run(customer.id, plan.id, plan.price_paise, start);
    res.status(201).json(loadSub(lastInsertRowid, req.userId));
  }));

  r.get('/subscriptions/:id', h((req, res) => res.json(loadSub(req.params.id, req.userId))));

  // POST /api/subscriptions/:id/pause  { start_date, end_date?, reason? }
  // end_date is the last paused day (inclusive); omit it for "pause until I resume".
  r.post('/subscriptions/:id/pause', h((req, res) => {
    const sub = loadSub(req.params.id, req.userId);
    const start = dateOr(req.body.start_date, todayLocal(), 'start_date');
    const end = dateOr(req.body.end_date, null, 'end_date');
    const reason = str(req.body.reason, 200);

    if (end && end < start) throw badRequest('end_date cannot be before start_date');
    if (start < sub.start_date) throw badRequest(`Pause cannot start before the subscription starts (${sub.start_date})`);
    if (sub.end_date && start > sub.end_date) throw badRequest(`Subscription ends on ${sub.end_date}`);
    const overlap = sub.pauses.find((p) => rangesOverlap(start, end, p.start_date, p.end_date));
    if (overlap) {
      throw new HttpError(409, `Overlaps an existing pause starting ${overlap.start_date}${overlap.end_date ? ` to ${overlap.end_date}` : ' (open-ended)'}`);
    }

    db.prepare('INSERT INTO pauses (subscription_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)')
      .run(sub.id, start, end, reason);
    res.status(201).json(loadSub(sub.id, req.userId));
  }));

  // POST /api/subscriptions/:id/resume  { date? }
  // `date` is the first day deliveries restart (default today). The active
  // pause is closed the day before; a pause resumed on its first day is removed.
  r.post('/subscriptions/:id/resume', h((req, res) => {
    const sub = loadSub(req.params.id, req.userId);
    const date = dateOr(req.body.date, todayLocal(), 'date');
    const pause = sub.pauses.find((p) => p.start_date <= date && (p.end_date === null || p.end_date >= date));
    if (!pause) throw badRequest(`Subscription is not paused on ${date}`);

    if (pause.start_date === date) db.prepare('DELETE FROM pauses WHERE id = ?').run(pause.id);
    else db.prepare('UPDATE pauses SET end_date = ? WHERE id = ?').run(addDays(date, -1), pause.id);
    res.json(loadSub(sub.id, req.userId));
  }));

  // DELETE /api/pauses/:id  – cancel a pause entirely (e.g. entered by mistake)
  r.delete('/pauses/:id', h((req, res) => {
    const pause = db.prepare(`
      SELECT p.* FROM pauses p JOIN subscriptions s ON s.id = p.subscription_id
      JOIN customers c ON c.id = s.customer_id WHERE p.id = ? AND c.owner_id = ?`).get(req.params.id, req.userId);
    if (!pause) throw notFound('Pause');
    db.prepare('DELETE FROM pauses WHERE id = ?').run(pause.id);
    res.status(204).end();
  }));

  // POST /api/subscriptions/:id/end  { end_date? }  – last delivery day (inclusive)
  r.post('/subscriptions/:id/end', h((req, res) => {
    const sub = loadSub(req.params.id, req.userId);
    const end = dateOr(req.body.end_date, todayLocal(), 'end_date');
    if (end < addDays(sub.start_date, -1)) throw badRequest('end_date cannot be before the subscription start');
    tx(db, () => {
      db.prepare('UPDATE subscriptions SET end_date = ? WHERE id = ?').run(end, sub.id);
      // Trim pauses that run past the new end date.
      db.prepare('DELETE FROM pauses WHERE subscription_id = ? AND start_date > ?').run(sub.id, end);
      db.prepare('UPDATE pauses SET end_date = ? WHERE subscription_id = ? AND (end_date IS NULL OR end_date > ?)').run(end, sub.id, end);
    });
    res.json(loadSub(sub.id, req.userId));
  }));

  // GET /api/subscriptions/:id/bill?month=YYYY-MM  – live preview, not saved
  r.get('/subscriptions/:id/bill', h((req, res) => {
    const sub = loadSub(req.params.id, req.userId);
    const month = req.query.month || todayLocal().slice(0, 7);
    if (!isValidMonth(month)) throw badRequest('month must be YYYY-MM');
    res.json({ subscription_id: sub.id, customer_name: sub.customer_name, plan_name: sub.plan_name, ...computeBill(sub, sub.pauses, month) });
  }));

  return r;
}
