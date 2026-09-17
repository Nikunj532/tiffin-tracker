import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBill, rangesOverlap } from '../src/billing.js';

// September 2026 starts on a Tuesday and has 22 weekdays.
// August 2026 starts on a Saturday and has 21 weekdays.
const PRICE = 300000; // ₹3,000.00
const sub = (start_date, end_date = null) => ({ start_date, end_date, price_paise: PRICE });

test('full month, no pauses -> full price', () => {
  const b = computeBill(sub('2026-08-15'), [], '2026-09');
  assert.equal(b.working_days, 22);
  assert.equal(b.delivered_days, 22);
  assert.equal(b.amount_paise, PRICE);
});

test('subscription starting mid-month is pro-rated', () => {
  const b = computeBill(sub('2026-09-14'), [], '2026-09');
  assert.equal(b.delivered_days, 13);
  assert.equal(b.amount_paise, Math.round((PRICE * 13) / 22)); // 177273
});

test('weekday pause is not billed', () => {
  const b = computeBill(sub('2026-09-01'), [{ start_date: '2026-09-07', end_date: '2026-09-11' }], '2026-09');
  assert.equal(b.paused_days, 5);
  assert.equal(b.delivered_days, 17);
  assert.equal(b.amount_paise, 231818);
});

test('weekend-only pause does not change the bill', () => {
  const b = computeBill(sub('2026-09-01'), [{ start_date: '2026-09-05', end_date: '2026-09-06' }], '2026-09');
  assert.equal(b.paused_days, 0);
  assert.equal(b.amount_paise, PRICE);
});

test('open-ended pause runs to month end', () => {
  const b = computeBill(sub('2026-09-01'), [{ start_date: '2026-09-28', end_date: null }], '2026-09');
  assert.equal(b.paused_days, 3);
  assert.equal(b.delivered_days, 19);
  assert.equal(b.amount_paise, 259091);
});

test('pause spanning two months is split correctly', () => {
  const pauses = [{ start_date: '2026-08-31', end_date: '2026-09-02' }];
  const aug = computeBill(sub('2026-08-01'), pauses, '2026-08');
  const sep = computeBill(sub('2026-08-01'), pauses, '2026-09');
  assert.equal(aug.paused_days, 1);
  assert.equal(aug.amount_paise, 285714);
  assert.equal(sep.paused_days, 2);
  assert.equal(sep.amount_paise, 272727);
});

test('paused for the whole month -> zero', () => {
  const b = computeBill(sub('2026-01-01'), [{ start_date: '2026-08-20', end_date: '2026-10-05' }], '2026-09');
  assert.equal(b.delivered_days, 0);
  assert.equal(b.amount_paise, 0);
});

test('subscription ended mid-month is billed up to its end date', () => {
  const b = computeBill(sub('2026-09-01', '2026-09-04'), [], '2026-09');
  assert.equal(b.subscribed_days, 4);
  assert.equal(b.amount_paise, 54545);
});

test('subscription starting after the month -> nothing billed', () => {
  const b = computeBill(sub('2026-10-01'), [], '2026-09');
  assert.equal(b.subscribed_days, 0);
  assert.equal(b.amount_paise, 0);
});

test('leap-year February counts correctly', () => {
  const b = computeBill(sub('2028-01-01'), [], '2028-02');
  assert.equal(b.working_days, 21);
  assert.equal(b.amount_paise, PRICE);
});

test('multiple pauses add up; days never counted twice', () => {
  const pauses = [
    { start_date: '2026-09-01', end_date: '2026-09-02' },
    { start_date: '2026-09-21', end_date: '2026-09-22' },
  ];
  const b = computeBill(sub('2026-09-01'), pauses, '2026-09');
  assert.equal(b.paused_days, 4);
  assert.equal(b.delivered_days + b.paused_days, b.subscribed_days);
});

test('rangesOverlap handles open ends', () => {
  assert.equal(rangesOverlap('2026-09-01', '2026-09-05', '2026-09-05', '2026-09-10'), true);
  assert.equal(rangesOverlap('2026-09-01', '2026-09-04', '2026-09-05', null), false);
  assert.equal(rangesOverlap('2026-09-10', null, '2026-09-01', null), true);
});
