import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;
let db;

before(async () => {
  delete process.env.JWT_SECRET;
  process.env.LOGIN_MAX_ATTEMPTS = '5';
  db = openDb(':memory:');
  const app = createApp(db, { log: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(method, path, body, token, rawBody) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

const register = async (email, password = 'password123') => (await call('POST', '/auth/register', { name: 'Owner', email, password })).body.token;

test('only the right password logs in; injection and wrong types never do', async () => {
  await register('a@test.com', 'correct-horse-1');
  const attempts = [
    { email: 'a@test.com', password: 'wrong-horse-1' },
    { email: 'a@test.com', password: 'CORRECT-HORSE-1' },
    { email: "' OR '1'='1", password: "' OR '1'='1" },
    { email: 'a@test.com', password: { $ne: '' } },
    { email: 'a@test.com', password: ['correct-horse-1'] },
  ];
  for (const body of attempts) {
    const r = await call('POST', '/auth/login', body);
    assert.equal(r.status, 401, JSON.stringify(body));
    assert.equal(r.body.token, undefined);
  }
  assert.equal((await call('POST', '/auth/login', { email: ' A@TEST.com ', password: 'correct-horse-1' })).status, 200);
  assert.equal((await call('POST', '/auth/login', null, undefined, '{"email": broken')).status, 400);
});

test('tokens: forged with the old default secret, tampered, alg none, expired, deleted user → 401', async () => {
  const token = await register('b@test.com');
  const me = (await call('GET', '/auth/me', undefined, token)).body.user;
  assert.equal(me.email, 'b@test.com');

  const [h, , sig] = token.split('.');
  const otherPayload = Buffer.from(JSON.stringify({ sub: me.id + 1 })).toString('base64url');
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: me.id })).toString('base64url')}.`;
  const bad = [
    jwt.sign({ sub: me.id }, 'dev-only-secret-change-me'), // previously hard-coded fallback
    `${h}.${otherPayload}.${sig}`,
    none,
    jwt.sign({ sub: me.id, exp: Math.floor(Date.now() / 1000) - 10 }, 'dev-only-secret-change-me'),
    'not-a-token',
  ];
  for (const t of bad) assert.equal((await call('GET', '/customers', undefined, t)).status, 401, t.slice(0, 30));
});

test('token of a deleted account is refused (no 500)', async () => {
  const token = await register('c@test.com');
  assert.equal((await call('POST', '/plans', { name: 'P', price_paise: 100 }, token)).status, 201);
  db.prepare("DELETE FROM users WHERE email = 'c@test.com'").run();
  assert.equal((await call('GET', '/auth/me', undefined, token)).status, 401);
  assert.equal((await call('POST', '/plans', { name: 'P2', price_paise: 100 }, token)).status, 401);
});

test('password rules: min 8, not only spaces, max 72 bytes (bcrypt truncation)', async () => {
  assert.equal((await call('POST', '/auth/register', { name: 'x', email: 'd1@test.com', password: 'short' })).status, 400);
  assert.equal((await call('POST', '/auth/register', { name: 'x', email: 'd2@test.com', password: '          ' })).status, 400);
  assert.equal((await call('POST', '/auth/register', { name: 'x', email: 'd3@test.com', password: 'a'.repeat(73) })).status, 400);
  assert.equal((await call('POST', '/auth/register', { name: 'x', email: 'd4@test.com', password: 'a'.repeat(72) })).status, 201);
  // A 72-byte password plus extra characters must not log in to that account.
  assert.equal((await call('POST', '/auth/login', { email: 'd4@test.com', password: 'a'.repeat(72) + 'extra' })).status, 401);
});

test('brute force: repeated failures lock that email for this client', async () => {
  await register('e@test.com', 'right-password-1');
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/auth/login', { email: 'e@test.com', password: `guess-${i}` })).status, 401);
  const locked = await call('POST', '/auth/login', { email: 'e@test.com', password: 'right-password-1' });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.token, undefined);
  await register('f@test.com', 'other-password-1');
  assert.equal((await call('POST', '/auth/login', { email: 'f@test.com', password: 'other-password-1' })).status, 200);
});

test('malformed ids and prices return 400, never 500', async () => {
  const token = await register('g@test.com');
  const plan = (await call('POST', '/plans', { name: 'Veg', price_paise: 250000 }, token)).body;
  const cust = (await call('POST', '/customers', { name: 'C', phone: '9000000001' }, token)).body;
  const sub = (await call('POST', `/customers/${cust.id}/subscriptions`, { plan_id: plan.id, start_date: '2026-09-01' }, token)).body;

  for (const plan_id of [{ id: plan.id }, [plan.id], 'abc', -1, 1.5, null]) {
    assert.equal((await call('POST', `/customers/${cust.id}/subscriptions`, { plan_id }, token)).status, 400, JSON.stringify(plan_id));
  }
  for (const to_customer_id of [{ id: 1 }, [1], 'x']) {
    assert.equal((await call('POST', `/subscriptions/${sub.id}/transfer`, { effective_date: '2026-09-20', to_customer_id }, token)).status, 400, JSON.stringify(to_customer_id));
  }
  for (const price_paise of [1e20, -5, 10.5, 'abc']) {
    assert.equal((await call('POST', '/plans', { name: 'Bad', price_paise }, token)).status, 400, String(price_paise));
  }
  assert.equal((await call('GET', '/customers/abc', undefined, token)).status, 404);
});
