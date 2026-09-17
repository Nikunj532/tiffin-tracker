import { Router } from 'express';
import { badRequest, h, HttpError, normalizePhone, notFound, PHONE_RE, str } from '../http.js';
import { addDays, isValidDate, isValidMonth, todayLocal } from '../dates.js';
import { computeBill, rangesOverlap } from '../billing.js';
import { tx } from '../db.js';
import { createNotificationService } from '../notifications.js';

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
    Object.assign(sub, transferLinks(db, sub));
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

  // POST /api/subscriptions/:id/transfer
  //   { effective_date, to_customer_id }                       – hand over to an existing customer
  //   { effective_date, customer: { name, phone, address } }   – or to a new one (reused if the phone exists)
  //
  // effective_date is the new customer's first delivery day. The current holder
  // is served up to the day before. The plan, the locked-in price and any fixed
  // end date carry over to a linked subscription, so the cycle continues
  // unbroken. Each customer is billed only for the weekdays they were served.
  r.post('/subscriptions/:id/transfer', h((req, res) => {
    const sub = loadSub(req.params.id, req.userId);
    const effective = dateOr(req.body.effective_date, todayLocal(), 'effective_date');

    if (effective <= sub.start_date) {
      throw badRequest(`effective_date must be after the subscription start (${sub.start_date}); to hand over from day one, edit the customer instead`);
    }
    if (sub.end_date && effective > sub.end_date) {
      throw badRequest(`Subscription already ended on ${sub.end_date}; nothing left to transfer`);
    }

    const result = tx(db, () => {
      const target = resolveTargetCustomer(db, req.userId, req.body);
      if (target.id === sub.customer_id) throw badRequest('Cannot transfer a subscription to the same customer');
      const clash = db.prepare('SELECT id, start_date FROM subscriptions WHERE customer_id = ? AND (end_date IS NULL OR end_date >= ?)')
        .get(target.customer.id, effective);
      if (clash) throw new HttpError(409, `${target.customer.name} already has a subscription running on or after ${effective}`);

      const lastDay = addDays(effective, -1);
      // Close the current holder's subscription, trimming pauses past the handover.
      db.prepare('UPDATE subscriptions SET end_date = ? WHERE id = ?').run(lastDay, sub.id);
      db.prepare('DELETE FROM pauses WHERE subscription_id = ? AND start_date > ?').run(sub.id, lastDay);
      db.prepare('UPDATE pauses SET end_date = ? WHERE subscription_id = ? AND (end_date IS NULL OR end_date > ?)').run(lastDay, sub.id, lastDay);

      // Same plan, same locked price, same end date: the cycle carries over.
      const { lastInsertRowid } = db.prepare(`
        INSERT INTO subscriptions (customer_id, plan_id, price_paise, start_date, end_date, transferred_from_id)
        VALUES (?, ?, ?, ?, ?, ?)`).run(target.customer.id, sub.plan_id, sub.price_paise, effective, sub.end_date, sub.id);

      const notifier = createNotificationService(db);
      const from = db.prepare('SELECT * FROM customers WHERE id = ?').get(sub.customer_id);
      notifier.send({
        owner_id: req.userId, customer_id: from.id, subscription_id: sub.id, recipient: from.phone,
        type: 'subscription_transferred_out', for_date: effective,
        message: `Hi ${from.name.split(/\s+/)[0]}, your ${sub.plan_name} tiffin has been transferred to ${target.customer.name} from ${effective}. Your last delivery is ${lastDay}.`,
        dedupe_key: `transfer_out:${lastInsertRowid}`,
      });
      notifier.send({
        owner_id: req.userId, customer_id: target.customer.id, subscription_id: Number(lastInsertRowid), recipient: target.customer.phone,
        type: 'subscription_transferred_in', for_date: effective,
        message: `Hi ${target.customer.name.split(/\s+/)[0]}, ${from.name}'s ${sub.plan_name} tiffin plan is now yours from ${effective}.`,
        dedupe_key: `transfer_in:${lastInsertRowid}`,
      });

      return { newId: Number(lastInsertRowid), createdCustomer: target.created };
    });

    const fromSub = loadSub(sub.id, req.userId);
    const toSub = loadSub(result.newId, req.userId);
    const month = effective.slice(0, 7);
    const fromBill = computeBill(fromSub, fromSub.pauses, month);
    const toBill = computeBill(toSub, toSub.pauses, month);
    res.status(201).json({
      effective_date: effective,
      created_customer: result.createdCustomer,
      from: fromSub,
      to: toSub,
      billing_split: {
        month,
        from: { customer_id: fromSub.customer_id, customer_name: fromSub.customer_name, ...fromBill },
        to: { customer_id: toSub.customer_id, customer_name: toSub.customer_name, ...toBill },
        combined_amount_paise: fromBill.amount_paise + toBill.amount_paise,
      },
    });
  }));

  return r;
}

/** Links between a subscription and the one it was transferred from / to. */
export function transferLinks(db, sub) {
  const from = sub.transferred_from_id
    ? db.prepare(`SELECT s.id AS subscription_id, c.id AS customer_id, c.name AS customer_name, s.end_date
        FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`).get(sub.transferred_from_id)
    : null;
  const to = db.prepare(`SELECT s.id AS subscription_id, c.id AS customer_id, c.name AS customer_name, s.start_date
      FROM subscriptions s JOIN customers c ON c.id = s.customer_id WHERE s.transferred_from_id = ?`).get(sub.id) || null;
  return { transferred_from: from, transferred_to: to };
}

function resolveTargetCustomer(db, owner, body) {
  if (body.to_customer_id !== undefined && body.to_customer_id !== null && body.to_customer_id !== '') {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND owner_id = ?').get(body.to_customer_id, owner);
    if (!customer) throw badRequest('to_customer_id must reference one of your customers');
    return { customer, id: customer.id, created: false };
  }
  const c = body.customer || {};
  const phone = normalizePhone(c.phone);
  if (!PHONE_RE.test(phone)) throw badRequest('Provide to_customer_id, or customer.phone (10–13 digits) for the new holder', { phone: 'Phone must be 10–13 digits' });
  const existing = db.prepare('SELECT * FROM customers WHERE owner_id = ? AND phone = ?').get(owner, phone);
  if (existing) return { customer: existing, id: existing.id, created: false };
  const name = str(c.name, 100);
  if (!name) throw badRequest('customer.name is required for a new customer', { name: 'Name is required' });
  const { lastInsertRowid } = db.prepare('INSERT INTO customers (owner_id, name, phone, address) VALUES (?, ?, ?, ?)')
    .run(owner, name, phone, str(c.address, 300));
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(lastInsertRowid);
  return { customer, id: customer.id, created: true };
}
