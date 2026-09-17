import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { badRequest, h, HttpError, jwtSecret, requireAuth, str } from '../http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcrypt only looks at the first 72 bytes; longer passwords would silently
// match anything sharing that prefix, so they are refused instead.
const MAX_PASSWORD_BYTES = 72;

const WINDOW_MS = 15 * 60 * 1000;
const maxAttempts = () => Number(process.env.LOGIN_MAX_ATTEMPTS) || 10;

export default function authRoutes(db) {
  const r = Router();

  const sign = (user) => jwt.sign({ sub: user.id }, jwtSecret(), { expiresIn: '7d', algorithm: 'HS256' });
  const publicUser = (u) => ({ id: u.id, name: u.name, business_name: u.business_name, email: u.email });

  // Failed-login throttle per (client IP, email): slows password guessing.
  const failures = new Map();
  const throttleKey = (req, email) => `${req.ip}|${email}`;
  const recentFailures = (key) => {
    const now = Date.now();
    const list = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
    if (list.length) failures.set(key, list); else failures.delete(key);
    return list;
  };

  r.post('/register', h((req, res) => {
    const name = str(req.body.name, 100);
    const business_name = str(req.body.business_name, 100);
    const email = str(req.body.email, 200).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!EMAIL_RE.test(email)) errors.email = 'A valid email is required';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters';
    else if (!password.trim()) errors.password = 'Password cannot be only spaces';
    else if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) errors.password = 'Password is too long (maximum 72 bytes, about 72 English characters)';
    if (Object.keys(errors).length) throw badRequest('Validation failed', errors);

    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'An account with this email already exists');
    }

    const hash = bcrypt.hashSync(password, 10);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, business_name, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(name, business_name, email, hash);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  }));

  r.post('/login', h((req, res) => {
    const email = str(req.body.email, 200).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const key = throttleKey(req, email);
    const recent = recentFailures(key);
    if (recent.length >= maxAttempts()) {
      const waitMin = Math.ceil((WINDOW_MS - (Date.now() - recent[0])) / 60000);
      res.set('Retry-After', String(waitMin * 60));
      throw new HttpError(429, `Too many failed login attempts. Try again in ${waitMin} minute${waitMin === 1 ? '' : 's'}.`);
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const valid = user
      && password.length > 0
      && Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES
      && bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      recent.push(Date.now());
      failures.set(key, recent);
      throw new HttpError(401, 'Invalid email or password');
    }
    failures.delete(key);
    res.json({ token: sign(user), user: publicUser(user) });
  }));

  r.get('/me', requireAuth, h((req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    res.json({ user: publicUser(user) });
  }));

  return r;
}
