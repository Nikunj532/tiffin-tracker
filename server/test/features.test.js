import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

// September 2026: Tue 1st; 22 weekdays. Mon 7th, Fri 11th, Sat 12th, Mon 14th, Tue 15th.
let server;
let root;
let token;
let plan;

before(async () => {
  const app = createApp(openDb(':memory:'), { log: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  root = `http://127.0.0.1:${server.address().port}`;
  token = (await call('POST', '/api/auth/register', { name: 'Owner', business_name: 'Maa Ki Rasoi', email: 'o@example.com', password: 'secret123' })).body.token;
  plan = (await call('POST', '/api/plans', { name: 'Veg Thali', price_paise: 220000 }, token)).body;
});
after(() => server.close());

async function call(method, path, body, auth, headers = {}) {
  const isText = typeof body === 'string';
  const res = await fetch(root + path, {
    method,
    headers: { 'Content-Type': isText ? 'text/csv' : 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers },
    body: body === undefined ? undefined : isText ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const addCustomer = async (name, phone) => (await call('POST', '/api/customers', { name, phone }, token)).body;
const subscribe = async (c, start = '2026-09-01') => (await call('POST', `/api/customers/${c.id}/subscriptions`, { plan_id: plan.id, start_date: start }, token)).body;

test('L1: POST /clock notifies only customers due a delivery; /outbox shows them', async () => {
  const active = await addCustomer('Asha Rao', '9000000001');
  const paused = await addCustomer('Bala K', '9000000002');
  const later = await addCustomer('Chitra S', '9000000003');
  await addCustomer('Dev NoPlan', '9000000004');
  const ended = await addCustomer('Esha Ended', '9000000005');
  await subscribe(active);
  const pSub = await subscribe(paused);
  await call('POST', `/api/subscriptions/${pSub.id}/pause`, { start_date: '2026-09-07', end_date: '2026-09-08' }, token);
  await subscribe(later, '2026-09-15');
  const eSub = await subscribe(ended);
  await call('POST', `/api/subscriptions/${eSub.id}/end`, { end_date: '2026-09-04' }, token);

  // Jump to Monday 7 Sep: only Asha is due (Bala paused, Chitra not started, Dev no plan, Esha ended).
  const tick = await call('POST', '/clock', { date: '2026-09-07' });
  assert.equal(tick.status, 200);
  assert.equal(tick.body.today, '2026-09-07');
  const monday = tick.body.mornings.find((m) => m.date === '2026-09-07');
  assert.deepEqual([monday.due, monday.notified], [1, 1]);

  const out = await call('GET', '/outbox?date=2026-09-07');
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.data.map((m) => [m.to, m.type]), [['9000000001', 'delivery_due']]);
  assert.match(out.body.data[0].message, /Veg Thali tiffin from Maa Ki Rasoi will be delivered today/);

  // Re-running the same morning does not duplicate.
  const again = await call('POST', '/clock', {});
  assert.equal(again.body.mornings[0].notified, 0);
  assert.equal((await call('GET', '/outbox?date=2026-09-07')).body.total, 1);

  // Advancing across a weekend: Sat/Sun send nothing, Monday 14th catches up. Tue 8th: Bala still paused.
  const week = await call('POST', '/clock', { advance_days: 7 });
  const byDate = Object.fromEntries(week.body.mornings.map((m) => [m.date, m]));
  assert.equal(week.body.mornings.length, 7);
  assert.equal(byDate['2026-09-08'].notified, 1);
  assert.equal(byDate['2026-09-09'].notified, 2); // Bala back
  assert.equal(byDate['2026-09-12'].delivery_day, false);
  assert.equal(byDate['2026-09-12'].notified, 0);
  assert.equal(byDate['2026-09-14'].notified, 2);

  // Chitra starts Tue 15th.
  await call('POST', '/clock', { date: '2026-09-15' });
  const tue = (await call('GET', '/outbox?date=2026-09-15&sort=recipient&order=asc')).body;
  assert.deepEqual(tue.data.map((m) => m.to), ['9000000001', '9000000002', '9000000003']);

  // App status follows the simulated clock.
  assert.equal((await call('GET', '/api/clock', undefined, token)).body.today, '2026-09-15');
  assert.equal((await call('GET', `/api/customers/${later.id}`, undefined, token)).body.status, 'active');

  // Authenticated outbox is scoped to the owner; another owner sees nothing.
  const other = (await call('POST', '/api/auth/register', { name: 'X', email: 'x@example.com', password: 'secret123' })).body.token;
  assert.equal((await call('GET', '/api/outbox', undefined, other)).body.total, 0);
  assert.ok((await call('GET', '/api/outbox', undefined, token)).body.total >= 8);

  assert.equal((await call('POST', '/clock', { date: 'tomorrow' })).status, 400);
});

test('L2: transfer mid-cycle carries plan and cycle; bill splits by who was served', async () => {
  const from = await addCustomer('Farah Old', '9100000001');
  const sub = await subscribe(from, '2026-09-01');
  // Farah pauses 3–4 Sep and had a future pause that should not follow the subscription.
  await call('POST', `/api/subscriptions/${sub.id}/pause`, { start_date: '2026-09-03', end_date: '2026-09-04' }, token);
  await call('POST', `/api/subscriptions/${sub.id}/pause`, { start_date: '2026-09-21', end_date: '2026-09-22' }, token);
  // Raise the plan price later: the transferred cycle must keep the locked price.
  await call('PUT', `/api/plans/${plan.id}`, { name: 'Veg Thali', price_paise: 300000 }, token);

  const res = await call('POST', `/api/subscriptions/${sub.id}/transfer`, {
    effective_date: '2026-09-14',
    customer: { name: 'Gaurav New', phone: '+91 91000 00002', address: 'Flat 2' },
  }, token);
  assert.equal(res.status, 201);
  const { from: f, to: t, billing_split: split } = res.body;
  assert.equal(res.body.created_customer, true);
  assert.equal(f.end_date, '2026-09-13');
  assert.equal(f.pauses.length, 1); // future pause dropped
  assert.equal(t.start_date, '2026-09-14');
  assert.equal(t.plan_id, plan.id);
  assert.equal(t.price_paise, 220000); // cycle carries over at the locked price
  assert.equal(t.transferred_from.customer_name, 'Farah Old');
  assert.equal(f.transferred_to.customer_name, 'Gaurav New');

  // Farah: weekdays 1–11 Sep = 9, minus 2 paused = 7. Gaurav: 14–30 Sep = 13.
  assert.equal(split.from.delivered_days, 7);
  assert.equal(split.to.delivered_days, 13);
  assert.equal(split.from.amount_paise, Math.round((220000 * 7) / 22));
  assert.equal(split.to.amount_paise, Math.round((220000 * 13) / 22));
  // Together they never pay more than the one plan.
  assert.ok(split.combined_amount_paise <= 220000);

  // Both appear in generated bills with transfer links.
  await call('POST', '/api/bills/generate', { month: '2026-09' }, token);
  const bills = (await call('GET', '/api/bills?month=2026-09&search=91000000', undefined, token)).body.data;
  const farah = bills.find((b) => b.customer_name === 'Farah Old');
  const gaurav = bills.find((b) => b.customer_name === 'Gaurav New');
  assert.equal(farah.transferred_to_name, 'Gaurav New');
  assert.equal(gaurav.transferred_from_name, 'Farah Old');
  assert.equal(farah.amount_paise + gaurav.amount_paise, split.combined_amount_paise);

  // Both parties were notified.
  const msgs = (await call('GET', '/api/outbox?limit=100', undefined, token)).body.data.map((m) => m.type).filter((t) => t.startsWith('subscription_transferred')).sort();
  assert.deepEqual(msgs, ['subscription_transferred_in', 'subscription_transferred_out']);

  // Guards
  assert.equal((await call('POST', `/api/subscriptions/${sub.id}/transfer`, { effective_date: '2026-09-20', customer: { name: 'Z', phone: '9100000009' } }, token)).status, 400); // already ended
  assert.equal((await call('POST', `/api/subscriptions/${t.id}/transfer`, { effective_date: '2026-09-14', to_customer_id: from.id }, token)).status, 400); // not mid-cycle
  assert.equal((await call('POST', `/api/subscriptions/${t.id}/transfer`, { effective_date: '2026-09-20', to_customer_id: t.customer_id }, token)).status, 400); // same person
  const busy = await addCustomer('Busy', '9100000003');
  await subscribe(busy, '2026-09-01');
  assert.equal((await call('POST', `/api/subscriptions/${t.id}/transfer`, { effective_date: '2026-09-20', to_customer_id: busy.id }, token)).status, 409);
});

test('L3: messy CSV import reports imported / deduped / rejected', async () => {
  await call('POST', '/api/plans', { name: 'Non-Veg Thali', price_paise: 450000 }, token);
  const existing = await addCustomer('Already Here', '9200000009');
  await subscribe(existing, '2026-09-01');

  const csv = [
    'Customer Name,Mobile No,Address,Meal Plan,Start Date,Notes',
    'ASHA IYER,+91 92000 00001,"12, MG Road",veg thali,01/09/2026,first',   // imported
    'Ravi Kumar,92000-00002,,Non-Veg Thali,2026-09-03,',                    // imported
    'asha iyer,9200000001,,Veg Thali,5 Sep 2026,dup of row 2',              // deduped (phone repeat)
    ',9200000003,,Veg Thali,2026-09-01,no name',                            // rejected
    'Meena,,,Veg Thali,2026-09-01,no phone',                                 // rejected
    'Kiran,9200000004,,Veg Thali,,no date',                                  // rejected
    'Tara,9200000005,,Pizza Plan,2026-09-01,bad plan',                       // rejected
    'Om,12345,,Veg Thali,31/02/2026,bad phone+date',                         // rejected
    ',,,,,',                                                                 // blank line, ignored
    'Already Here,09200000009,,Veg Thali,Sep 10 2026,existing subscriber',  // deduped (already subscribed)
    'Neha Joshi,9200000006,,VEG THALI,09/25/2026,',                          // imported (month-first)
    '',
  ].join('\r\n');

  const dry = await call('POST', '/api/import/customers', { csv, dry_run: true }, token);
  assert.equal(dry.status, 200);
  assert.deepEqual([dry.body.imported, dry.body.deduped, dry.body.rejected], [3, 2, 5]);
  assert.equal((await call('GET', '/api/customers/phone/9200000001', undefined, token)).status, 404); // nothing written

  const res = await call('POST', '/api/import/customers', { csv }, token);
  assert.equal(res.status, 201);
  const { imported, deduped, rejected, details } = res.body;
  assert.deepEqual({ imported, deduped, rejected }, { imported: 3, deduped: 2, rejected: 5 });
  assert.equal(res.body.blank_rows_ignored, 1);
  assert.deepEqual(res.body.unknown_columns, ['Notes']);
  assert.deepEqual(details.deduped.map((d) => d.row), [4, 11]);
  assert.equal(details.deduped[0].duplicate_of_row, 2);
  assert.deepEqual(details.rejected.map((r) => r.row), [5, 6, 7, 8, 9]);
  assert.equal(details.rejected.find((r) => r.row === 9).reasons.length, 2);

  // Clean data landed.
  const asha = (await call('GET', '/api/customers/phone/9200000001', undefined, token)).body;
  assert.equal(asha.name, 'Asha Iyer');
  assert.equal(asha.address, '12, MG Road');
  const ashaDetail = (await call('GET', `/api/customers/${asha.id}`, undefined, token)).body;
  assert.equal(ashaDetail.subscriptions[0].start_date, '2026-09-01');
  assert.equal(ashaDetail.subscriptions[0].plan_name, 'Veg Thali');
  const neha = (await call('GET', '/api/customers/phone/9200000006', undefined, token)).body;
  assert.equal((await call('GET', `/api/customers/${neha.id}`, undefined, token)).body.subscriptions[0].start_date, '2026-09-25');

  // Importing the same file again: everything valid is now a duplicate.
  const again = (await call('POST', '/api/import/customers', { csv }, token)).body;
  assert.deepEqual([again.imported, again.deduped, again.rejected], [0, 5, 5]);

  // JSON rows + raw text/csv + defaults
  const json = (await call('POST', '/api/import/customers', {
    rows: [{ Name: 'Json One', 'Mobile No': 9200000101, Plan: '', 'Start Date': '' }],
    default_plan_id: plan.id, default_start_date: '2026-09-07',
  }, token)).body;
  assert.equal(json.imported, 1);
  assert.equal(json.details.imported[0].warnings.length, 2);
  const raw = await call('POST', '/api/import/customers', 'name,phone,plan,start_date\nRaw Csv,9200000102,Veg Thali,7-9-2026', token);
  assert.equal(raw.body.imported, 1);

  assert.equal((await call('POST', '/api/import/customers', { csv: 'foo,bar\n1,2' }, token)).status, 400);
  assert.equal((await call('POST', '/api/import/customers', { csv })).status, 401);
});
