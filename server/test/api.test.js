import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;

before(async () => {
  const app = createApp(openDb(':memory:'), { log: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function register(email) {
  const r = await call('POST', '/auth/register', { name: 'Owner', business_name: 'Maa Ki Rasoi', email, password: 'secret123' });
  assert.equal(r.status, 201);
  return r.body.token;
}

test('full owner flow: subscribe, pause, resume, bill, lookups', async () => {
  const token = await register('owner@example.com');

  // Auth
  assert.equal((await call('GET', '/customers')).status, 401);
  assert.equal((await call('POST', '/auth/register', { name: 'X', email: 'owner@example.com', password: 'secret123' })).status, 409);
  assert.equal((await call('POST', '/auth/login', { email: 'owner@example.com', password: 'wrongpass' })).status, 401);
  const login = await call('POST', '/auth/login', { email: 'OWNER@example.com', password: 'secret123' });
  assert.equal(login.status, 200);
  assert.equal((await call('GET', '/auth/me', null, token)).body.user.email, 'owner@example.com');

  // Plan + customers
  const plan = (await call('POST', '/plans', { name: 'Veg Thali', price_paise: 300000 }, token)).body;
  assert.equal((await call('POST', '/plans', { name: '', price_paise: -1 }, token)).status, 400);

  const asha = (await call('POST', '/customers', { name: 'Asha Rao', phone: '98765 43210', address: 'Koramangala' }, token)).body;
  assert.equal(asha.phone, '9876543210');
  assert.equal((await call('POST', '/customers', { name: 'Dup', phone: '9876543210' }, token)).status, 409);
  const bala = (await call('POST', '/customers', { name: 'Bala K', phone: '9000000001' }, token)).body;
  await call('POST', '/customers', { name: 'Chitra', phone: '9000000002' }, token);

  // Subscribe
  const sub = (await call('POST', `/customers/${asha.id}/subscriptions`, { plan_id: plan.id, start_date: '2026-09-01' }, token)).body;
  assert.equal(sub.price_paise, 300000);
  assert.equal((await call('POST', `/customers/${asha.id}/subscriptions`, { plan_id: plan.id, start_date: '2026-09-10' }, token)).status, 409);
  await call('POST', `/customers/${bala.id}/subscriptions`, { plan_id: plan.id, start_date: '2026-09-14' }, token);

  // Pause 7–11 Sep, overlapping pause rejected, open pause from 28th then resume on 30th
  assert.equal((await call('POST', `/subscriptions/${sub.id}/pause`, { start_date: '2026-09-07', end_date: '2026-09-11', reason: 'Travel' }, token)).status, 201);
  assert.equal((await call('POST', `/subscriptions/${sub.id}/pause`, { start_date: '2026-09-10', end_date: '2026-09-12' }, token)).status, 409);
  assert.equal((await call('POST', `/subscriptions/${sub.id}/pause`, { start_date: '2026-09-05', end_date: '2026-09-01' }, token)).status, 400);
  assert.equal((await call('POST', `/subscriptions/${sub.id}/pause`, { start_date: '2026-09-28' }, token)).status, 201);
  assert.equal((await call('POST', `/subscriptions/${sub.id}/resume`, { date: '2026-09-20' }, token)).status, 400);
  const resumed = await call('POST', `/subscriptions/${sub.id}/resume`, { date: '2026-09-30' }, token);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.pauses.find((p) => p.start_date === '2026-09-28').end_date, '2026-09-29');

  // Status on specific dates
  const onPause = await call('GET', '/customers?status=paused&as_of=2026-09-08', null, token);
  assert.deepEqual(onPause.body.data.map((c) => c.name), ['Asha Rao']);
  assert.equal(onPause.body.counts.upcoming, 1); // Bala starts 14th
  assert.equal(onPause.body.counts.inactive, 1); // Chitra

  // Bill preview: 22 working days, paused 5 + 2 = 7 -> 15 delivered
  const preview = (await call('GET', `/subscriptions/${sub.id}/bill?month=2026-09`, null, token)).body;
  assert.equal(preview.delivered_days, 15);
  assert.equal(preview.amount_paise, Math.round((300000 * 15) / 22));

  // Generate + list bills
  const gen = (await call('POST', '/bills/generate', { month: '2026-09' }, token)).body;
  assert.equal(gen.bills_generated, 2);
  const bills = (await call('GET', '/bills?month=2026-09&sort=amount&order=desc', null, token)).body;
  assert.equal(bills.total, 2);
  // Asha: 15 delivered days, Bala: 13 -> Asha's bill is larger
  assert.equal(bills.data[0].customer_name, 'Asha Rao');
  assert.ok(bills.data[0].amount_paise >= bills.data[1].amount_paise);
  assert.equal(bills.summary.total_amount_paise, gen.total_amount_paise);

  // Regenerating is idempotent
  assert.equal((await call('POST', '/bills/generate', { month: '2026-09' }, token)).body.total_amount_paise, gen.total_amount_paise);

  // Lookups, search, pagination, sorting
  assert.equal((await call('GET', '/customers/phone/98765-43210', null, token)).body.name, 'Asha Rao');
  assert.equal((await call('GET', '/customers/phone/1111111111', null, token)).status, 404);
  assert.equal((await call('GET', '/customers?search=bala', null, token)).body.total, 1);
  const page2 = (await call('GET', '/customers?limit=2&page=2&sort=name&order=asc', null, token)).body;
  assert.equal(page2.totalPages, 2);
  assert.deepEqual(page2.data.map((c) => c.name), ['Chitra']);
  const desc = (await call('GET', '/customers?sort=name&order=desc', null, token)).body;
  assert.equal(desc.data[0].name, 'Chitra');
  // Unknown sort key falls back safely (no SQL injection)
  assert.equal((await call('GET', '/customers?sort=name;DROP TABLE users', null, token)).status, 200);

  // Owner isolation
  const other = await register('other@example.com');
  assert.equal((await call('GET', '/customers', null, other)).body.total, 0);
  assert.equal((await call('GET', `/customers/${asha.id}`, null, other)).status, 404);
  assert.equal((await call('POST', `/subscriptions/${sub.id}/pause`, { start_date: '2026-09-15' }, other)).status, 404);
});
