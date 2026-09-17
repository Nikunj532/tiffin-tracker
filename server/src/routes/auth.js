import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { badRequest, h, HttpError, jwtSecret, requireAuth, str } from '../http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function authRoutes(db) {
  const r = Router();

  const sign = (user) => jwt.sign({ sub: user.id }, jwtSecret(), { expiresIn: '7d' });
  const publicUser = (u) => ({ id: u.id, name: u.name, business_name: u.business_name, email: u.email });

  r.post('/register', h((req, res) => {
    const name = str(req.body.name, 100);
    const business_name = str(req.body.business_name, 100);
    const email = str(req.body.email, 200).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    const errors = {};
    if (!name) errors.name = 'Name is required';
    if (!EMAIL_RE.test(email)) errors.email = 'A valid email is required';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters';
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
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    res.json({ token: sign(user), user: publicUser(user) });
  }));

  r.get('/me', requireAuth, h((req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) throw new HttpError(401, 'User no longer exists');
    res.json({ user: publicUser(user) });
  }));

  return r;
}
