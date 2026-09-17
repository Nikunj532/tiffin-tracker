import { Router } from 'express';
import { badRequest, h, HttpError, notFound, pageParams, paged, str } from '../http.js';

export default function planRoutes(db) {
  const r = Router();

  const SORTABLE = { name: 'p.name COLLATE NOCASE', price: 'p.price_paise', created_at: 'p.created_at', subscribers: 'subscribers' };

  const parse = (body) => {
    const name = str(body.name, 100);
    const description = str(body.description, 500);
    const price_paise = Number(body.price_paise);
    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!Number.isInteger(price_paise) || price_paise <= 0) errors.price_paise = 'Price must be a positive whole number of paise';
    if (Object.keys(errors).length) throw badRequest('Validation failed', errors);
    return { name, description, price_paise, is_active: body.is_active === false ? 0 : 1 };
  };

  const get = (id, owner) => {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND owner_id = ?').get(id, owner);
    if (!plan) throw notFound('Plan');
    return plan;
  };

  r.get('/', h((req, res) => {
    const p = pageParams(req.query, SORTABLE, 'name');
    const search = `%${str(req.query.search)}%`;
    const where = 'p.owner_id = ? AND p.name LIKE ?';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM plans p WHERE ${where}`).get(req.userId, search).n;
    const rows = db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.end_date IS NULL) AS subscribers
      FROM plans p WHERE ${where}
      ORDER BY ${p.orderBy}, p.id LIMIT ? OFFSET ?`).all(req.userId, search, p.limit, p.offset);
    res.json(paged(rows, total, p));
  }));

  r.post('/', h((req, res) => {
    const v = parse(req.body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO plans (owner_id, name, description, price_paise, is_active) VALUES (?, ?, ?, ?, ?)')
      .run(req.userId, v.name, v.description, v.price_paise, v.is_active);
    res.status(201).json(get(lastInsertRowid, req.userId));
  }));

  r.get('/:id', h((req, res) => res.json(get(req.params.id, req.userId))));

  r.put('/:id', h((req, res) => {
    get(req.params.id, req.userId);
    const v = parse(req.body);
    db.prepare('UPDATE plans SET name = ?, description = ?, price_paise = ?, is_active = ? WHERE id = ?')
      .run(v.name, v.description, v.price_paise, v.is_active, req.params.id);
    res.json(get(req.params.id, req.userId));
  }));

  r.delete('/:id', h((req, res) => {
    get(req.params.id, req.userId);
    const used = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = ?').get(req.params.id).n;
    if (used) throw new HttpError(409, 'Plan has subscriptions; mark it inactive instead of deleting');
    db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
    res.status(204).end();
  }));

  return r;
}
