import { Router } from 'express';
import {
  badRequest, h, HttpError, normalizePhone, notFound, pageParams, paged, PHONE_RE, str,
} from '../http.js';
import { isValidDate, todayLocal } from '../dates.js';
import { transferLinks } from './subscriptions.js';

// Status is derived from dates, never stored, so it can't go stale.
//   paused   – has a subscription running on @t and a pause covering @t
//   active   – has a subscription running on @t, no pause on @t
//   upcoming – only a subscription starting after @t
//   inactive – no current or future subscription
export const STATUS_SQL = `
  CASE
    WHEN EXISTS (
      SELECT 1 FROM subscriptions s JOIN pauses p ON p.subscription_id = s.id
      WHERE s.customer_id = c.id
        AND s.start_date <= @t AND (s.end_date IS NULL OR s.end_date >= @t)
        AND p.start_date <= @t AND (p.end_date IS NULL OR p.end_date >= @t)
    ) THEN 'paused'
    WHEN EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.customer_id = c.id AND s.start_date <= @t AND (s.end_date IS NULL OR s.end_date >= @t)
    ) THEN 'active'
    WHEN EXISTS (
      SELECT 1 FROM subscriptions s WHERE s.customer_id = c.id AND s.start_date > @t
    ) THEN 'upcoming'
    ELSE 'inactive'
  END`;

const STATUSES = ['active', 'paused', 'upcoming', 'inactive'];

const SORTABLE = {
  name: 'name COLLATE NOCASE',
  phone: 'phone',
  created_at: 'created_at',
  status: 'status',
  plan: 'plan_name COLLATE NOCASE',
};

export function asOf(query) {
  return isValidDate(query.as_of) ? query.as_of : todayLocal();
}

export default function customerRoutes(db) {
  const r = Router();

  const baseSelect = `
    SELECT * FROM (
      SELECT c.*, ${STATUS_SQL} AS status,
        (SELECT pl.name FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
          WHERE s.customer_id = c.id AND (s.end_date IS NULL OR s.end_date >= @t)
          ORDER BY s.start_date DESC LIMIT 1) AS plan_name
      FROM customers c WHERE c.owner_id = @owner
    )`;

  const getCustomer = (id, owner, t) => {
    const row = db.prepare(`${baseSelect} WHERE id = @id`).get({ owner, t, id: Number(id) });
    if (!row) throw notFound('Customer');
    return row;
  };

  const parse = (body) => {
    const name = str(body.name, 100);
    const phone = normalizePhone(body.phone);
    const address = str(body.address, 300);
    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!PHONE_RE.test(phone)) errors.phone = 'Phone must be 10–13 digits (optionally starting with +)';
    if (Object.keys(errors).length) throw badRequest('Validation failed', errors);
    return { name, phone, address };
  };

  const phoneTaken = (phone, owner, exceptId = 0) =>
    db.prepare('SELECT 1 FROM customers WHERE owner_id = ? AND phone = ? AND id != ?').get(owner, phone, exceptId);

  // GET /api/customers?search=&status=&page=&limit=&sort=&order=
  r.get('/', h((req, res) => {
    const t = asOf(req.query);
    const p = pageParams(req.query, SORTABLE, 'name');
    const status = STATUSES.includes(req.query.status) ? req.query.status : '';
    const params = { owner: req.userId, t, q: `%${str(req.query.search)}%`, status };
    const where = `WHERE (name LIKE @q OR phone LIKE @q OR address LIKE @q) AND (@status = '' OR status = @status)`;

    const total = db.prepare(`SELECT COUNT(*) AS n FROM (${baseSelect} ${where})`).get(params).n;
    const rows = db.prepare(`${baseSelect} ${where} ORDER BY ${p.orderBy}, id LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: p.limit, offset: p.offset });

    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const row of db.prepare(`SELECT status, COUNT(*) AS n FROM (${baseSelect}) GROUP BY status`).all({ owner: req.userId, t })) {
      counts[row.status] = row.n;
    }
    res.json({ ...paged(rows, total, p), counts, as_of: t });
  }));

  // Exact lookup by phone (the owner's most common action).
  r.get('/phone/:phone', h((req, res) => {
    const phone = normalizePhone(req.params.phone);
    const row = db.prepare('SELECT id FROM customers WHERE owner_id = ? AND phone = ?').get(req.userId, phone);
    if (!row) throw notFound('Customer with this phone');
    res.json(getCustomer(row.id, req.userId, asOf(req.query)));
  }));

  r.post('/', h((req, res) => {
    const v = parse(req.body);
    if (phoneTaken(v.phone, req.userId)) throw new HttpError(409, 'A customer with this phone already exists');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO customers (owner_id, name, phone, address) VALUES (?, ?, ?, ?)')
      .run(req.userId, v.name, v.phone, v.address);
    res.status(201).json(getCustomer(lastInsertRowid, req.userId, todayLocal()));
  }));

  // Customer detail with full subscription + pause history.
  r.get('/:id', h((req, res) => {
    const t = asOf(req.query);
    const customer = getCustomer(req.params.id, req.userId, t);
    const subscriptions = db.prepare(`
      SELECT s.*, pl.name AS plan_name FROM subscriptions s JOIN plans pl ON pl.id = s.plan_id
      WHERE s.customer_id = ? ORDER BY s.start_date DESC`).all(customer.id);
    const pauseStmt = db.prepare('SELECT * FROM pauses WHERE subscription_id = ? ORDER BY start_date DESC');
    for (const s of subscriptions) Object.assign(s, { pauses: pauseStmt.all(s.id) }, transferLinks(db, s));
    res.json({ ...customer, subscriptions });
  }));

  r.put('/:id', h((req, res) => {
    getCustomer(req.params.id, req.userId, todayLocal());
    const v = parse(req.body);
    if (phoneTaken(v.phone, req.userId, Number(req.params.id))) throw new HttpError(409, 'A customer with this phone already exists');
    db.prepare('UPDATE customers SET name = ?, phone = ?, address = ? WHERE id = ?').run(v.name, v.phone, v.address, req.params.id);
    res.json(getCustomer(req.params.id, req.userId, todayLocal()));
  }));

  r.delete('/:id', h((req, res) => {
    getCustomer(req.params.id, req.userId, todayLocal());
    db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
    res.status(204).end();
  }));

  return r;
}
