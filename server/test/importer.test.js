import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRecord, csvToRecords, parseCsv, parseLooseDate, tidyName } from '../src/importer.js';
import { normalizePhone } from '../src/http.js';

test('parseLooseDate understands mixed formats', () => {
  const cases = {
    '2026-09-01': '2026-09-01',
    '2026/9/1': '2026-09-01',
    '20260901': '2026-09-01',
    '01/09/2026': '2026-09-01', // day first (Indian default)
    '1-9-26': '2026-09-01',
    '01.09.2026': '2026-09-01',
    '25/09/2026': '2026-09-25',
    '09/25/2026': '2026-09-25', // month first only when day > 12 proves it
    '1 Sep 2026': '2026-09-01',
    '1st September 2026': '2026-09-01',
    'Sep 1, 2026': '2026-09-01',
    'September 1 2026': '2026-09-01',
    '01-Sep-26': '2026-09-01',
    '  2026-09-01T10:00:00Z ': '2026-09-01',
  };
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(parseLooseDate(input).date, expected, input);
  }
  assert.match(parseLooseDate('03/04/2026').warning, /ambiguous/);
  assert.equal(parseLooseDate('').date, null);
  assert.equal(parseLooseDate('   ').date, null);
  assert.ok(parseLooseDate('31/02/2026').error);
  assert.ok(parseLooseDate('next monday').error);
  assert.ok(parseLooseDate('2026-13-01').error);
});

test('normalizePhone collapses common Indian formats', () => {
  for (const p of ['9845000000', '+91 98450 00000', '91-9845000000', '098450-00000', '(984) 500-0000', '98450.00000']) {
    assert.equal(normalizePhone(p), '9845000000', p);
  }
  assert.equal(normalizePhone(9845000000), '9845000000');
});

test('parseCsv handles quotes, CRLF, BOM and semicolons', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(parseCsv('name;phone\nAsha;98'), [['name', 'phone'], ['Asha', '98']]);
});

test('csvToRecords maps header aliases and line numbers', () => {
  const { records, unknownHeaders, missingHeaders } = csvToRecords('Customer Name,Mobile No,Meal Plan,Start Date,Notes\nAsha,98,Veg,1/9/2026,x');
  assert.deepEqual(missingHeaders, []);
  assert.deepEqual(unknownHeaders, ['Notes']);
  assert.equal(records[0].row, 2);
  assert.deepEqual(records[0].values, { name: 'Asha', phone: '98', plan: 'Veg', start_date: '1/9/2026' });
});

test('tidyName fixes all-caps and all-lower names only', () => {
  assert.equal(tidyName('  ASHA   RAO '), 'Asha Rao');
  assert.equal(tidyName("d'souza"), "D'Souza");
  assert.equal(tidyName('McDonald'), 'McDonald');
});

test('cleanRecord collects every problem with a row', () => {
  const plans = [{ id: 1, name: 'Veg Thali', is_active: 1 }, { id: 2, name: 'Old Plan', is_active: 0 }];
  const bad = cleanRecord({ name: '', phone: '12', plan: 'Pizza', start_date: 'soon' }, { plans });
  assert.equal(bad.ok, false);
  assert.equal(bad.reasons.length, 4);
  assert.match(cleanRecord({ name: 'A', phone: '9845000000', plan: 'old plan', start_date: '2026-09-01' }, { plans }).reasons[0], /retired/);

  const good = cleanRecord({ name: 'asha rao', phone: '+91 98450 00000', plan: ' veg  THALI ', start_date: '' }, { plans, defaultStartDate: '2026-09-01' });
  assert.equal(good.ok, true);
  assert.deepEqual(good.value.plan, plans[0]);
  assert.equal(good.value.start_date, '2026-09-01');
  assert.equal(good.value.name, 'Asha Rao');
  assert.equal(good.warnings.length, 1);
});
