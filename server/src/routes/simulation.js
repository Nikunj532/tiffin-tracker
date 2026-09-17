import { Router } from 'express';
import { h, HttpError, optionalAuth, pageParams, paged, requireAuth, str } from '../http.js';
import { isValidDate } from '../dates.js';
import { clockState, tickClock } from '../clock.js';

const SORTABLE = {
  id: 'o.id',
  created_at: 'o.created_at',
  for_date: 'o.for_date',
  recipient: 'o.recipient',
  customer: 'c.name COLLATE NOCASE',
  type: 'o.type',
};

/**
 * Clock + outbox. Mounted at both /clock, /outbox (grading harness) and
 * /api/clock, /api/outbox (the app). With a token, /outbox shows only that
 * owner's messages. Without one it shows all messages – allowed only while
 * PUBLIC_SIM_ENDPOINTS is not "false".
 */
export default function simulationRoutes(db) {
  const r = Router();
  const publicAllowed = () => process.env.PUBLIC_SIM_ENDPOINTS !== 'false';
  const auth = (req, res, next) => (publicAllowed() ? optionalAuth(req, res, next) : requireAuth(req, res, next));

  r.get('/clock', auth, h((_req, res) => res.json(clockState())));

  r.post('/clock', auth, h((req, res) => res.json(tickClock(db, req.body || {}))));

  // GET /outbox?date=&type=&customer_id=&search=&page=&limit=&sort=&order=
  r.get('/outbox', auth, h((req, res) => {
    const p = pageParams(req.query, SORTABLE, 'id');
    if (!req.query.sort) { p.orderBy = 'o.id DESC'; p.order = 'DESC'; } // newest first by default
    if (req.query.date && !isValidDate(req.query.date)) throw new HttpError(400, 'date must be YYYY-MM-DD');

    const where = [];
    const args = {};
    if (req.userId) { where.push('o.owner_id = @owner'); args.owner = req.userId; }
    if (req.query.date) { where.push('o.for_date = @date'); args.date = req.query.date; }
    if (req.query.type) { where.push('o.type = @type'); args.type = str(req.query.type, 50); }
    if (req.query.customer_id) { where.push('o.customer_id = @cid'); args.cid = Number(req.query.customer_id); }
    if (req.query.search) { where.push('(o.recipient LIKE @q OR c.name LIKE @q OR o.message LIKE @q)'); args.q = `%${str(req.query.search)}%`; }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = 'FROM outbox o LEFT JOIN customers c ON c.id = o.customer_id';

    const total = db.prepare(`SELECT COUNT(*) AS n ${from} ${clause}`).get(args).n;
    const rows = db.prepare(`
      SELECT o.id, o.channel, o.recipient AS "to", o.type, o.for_date AS date, o.message, o.status,
             o.customer_id, c.name AS customer_name, o.subscription_id, o.created_at
      ${from} ${clause} ORDER BY ${p.orderBy}, o.id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...args, limit: p.limit, offset: p.offset });
    res.json(paged(rows, total, p));
  }));

  return r;
}
