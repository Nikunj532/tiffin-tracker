import jwt from 'jsonwebtoken';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);

/** Wrap sync/async handlers so thrown errors reach the error middleware. */
export const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};

export function jwtSecret() {
  return process.env.JWT_SECRET || 'dev-only-secret-change-me';
}

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, jwtSecret());
    req.userId = payload.sub;
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

/**
 * Parse page/limit/sort/order from the query string. `sortable` maps public
 * sort keys to trusted SQL expressions, so user input never reaches SQL.
 */
export function pageParams(query, sortable, defaultSort) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const sortKey = Object.hasOwn(sortable, query.sort) ? query.sort : defaultSort;
  const order = String(query.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return { page, limit, offset: (page - 1) * limit, sortKey, orderBy: `${sortable[sortKey]} ${order}`, order };
}

export function paged(data, total, { page, limit, sortKey, order }) {
  return { data, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), sort: sortKey, order: order.toLowerCase() };
}

export function str(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function normalizePhone(v) {
  return typeof v === 'string' ? v.replace(/[\s\-()]/g, '') : '';
}

export const PHONE_RE = /^\+?\d{10,13}$/;
