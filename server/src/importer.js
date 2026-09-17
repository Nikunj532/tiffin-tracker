// Pure helpers for importing a messy customer list. No database access here,
// so every cleaning rule is unit-testable on its own.
import { formatDate, isValidDate } from './dates.js';
import { normalizePhone, PHONE_RE } from './http.js';

/* ---------------------------------------------------------------- CSV ---- */

/**
 * Parse CSV text into an array of string arrays. Handles quoted fields,
 * escaped quotes (""), CR/LF line endings, a UTF-8 BOM, and auto-detects
 * comma, semicolon or tab delimiters from the header line.
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delimiter = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ------------------------------------------------------------ Headers ---- */

const HEADER_ALIASES = {
  name: ['name', 'customer', 'customername', 'fullname', 'client', 'clientname'],
  phone: ['phone', 'mobile', 'phoneno', 'phonenumber', 'mobileno', 'mobilenumber', 'contact', 'contactno', 'whatsapp', 'cell'],
  address: ['address', 'deliveryaddress', 'addr', 'location', 'area'],
  plan: ['plan', 'planname', 'mealplan', 'package', 'tiffin', 'tiffinplan'],
  start_date: ['startdate', 'start', 'from', 'subscriptionstart', 'joined', 'joiningdate', 'joindate', 'date', 'startedon'],
};

export function mapHeader(header) {
  const key = String(header ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(key)) return field;
  return null;
}

/** CSV text → [{ row, values: {name, phone, ...} }] using the header row. */
export function csvToRecords(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { records: [], unknownHeaders: [], missingHeaders: Object.keys(HEADER_ALIASES) };
  const header = rows[0].map(mapHeader);
  const unknownHeaders = rows[0].filter((_, i) => !header[i]).map((h) => h.trim()).filter(Boolean);
  const missingHeaders = ['name', 'phone'].filter((f) => !header.includes(f));
  const records = rows.slice(1).map((cells, i) => {
    const values = {};
    header.forEach((field, col) => { if (field && values[field] === undefined) values[field] = cells[col] ?? ''; });
    return { row: i + 2, values }; // spreadsheet line number (header is line 1)
  });
  return { records, unknownHeaders, missingHeaders };
}

/* -------------------------------------------------------------- Dates ---- */

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const build = (y, m, d) => {
  const year = y < 100 ? 2000 + y : y;
  const s = formatDate(new Date(Date.UTC(year, m - 1, d)));
  return isValidDate(s) && Number(s.slice(0, 4)) === year && Number(s.slice(5, 7)) === m && Number(s.slice(8)) === d ? s : null;
};

/**
 * Parse the date formats people actually type. Returns { date, warning } or
 * { date: null } when blank, or { error } when unreadable.
 *
 *   2026-09-01, 2026/9/1, 20260901            year first
 *   01/09/2026, 1-9-26, 01.09.2026            day first (Indian default)
 *   09/25/2026                                 month first, only when day > 12 proves it
 *   1 Sep 2026, 1st September 2026, Sep 1, 2026, 01-Sep-26
 */
export function parseLooseDate(input) {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return { date: formatDate(input) };
  const s = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return { date: null };

  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/))) {
    const date = build(+m[1], +m[2], +m[3]);
    return date ? { date } : { error: `"${s}" is not a real date` };
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    const date = build(+m[1], +m[2], +m[3]);
    return date ? { date } : { error: `"${s}" is not a real date` };
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    const a = +m[1]; const b = +m[2]; const y = +m[3];
    if (a > 12 && b <= 12) return build(y, b, a) ? { date: build(y, b, a) } : { error: `"${s}" is not a real date` };
    if (b > 12 && a <= 12) return build(y, a, b) ? { date: build(y, a, b), warning: `"${s}" read as month/day/year` } : { error: `"${s}" is not a real date` };
    const date = build(y, b, a);
    if (!date) return { error: `"${s}" is not a real date` };
    return a === b ? { date } : { date, warning: `"${s}" is ambiguous; read as day/month/year` };
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?[ ,-]+(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    const date = mon && build(+m[3], mon, +m[1]);
    return date ? { date } : { error: `"${s}" is not a recognisable date` };
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/))) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    const date = mon && build(+m[3], mon, +m[2]);
    return date ? { date } : { error: `"${s}" is not a recognisable date` };
  }
  return { error: `"${s}" is not a recognisable date` };
}

/* ------------------------------------------------------------ Cleaning --- */

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Title-case names typed in ALL CAPS or all lower case; leave mixed case alone. */
export function tidyName(v) {
  const s = clean(v);
  if (s && (s === s.toUpperCase() || s === s.toLowerCase())) {
    return s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
  }
  return s;
}

export const isBlankRecord = (values) => Object.values(values).every((v) => clean(v) === '');

/**
 * Validate and normalise one record. `plans` is the owner's plan list.
 * Returns { ok: true, value, warnings } or { ok: false, reasons }.
 */
export function cleanRecord(values, { plans, defaultPlanId = null, defaultStartDate = null }) {
  const reasons = [];
  const warnings = [];

  const name = tidyName(values.name);
  if (!name) reasons.push('name is blank');

  const rawPhone = clean(values.phone);
  const phone = normalizePhone(rawPhone);
  if (!rawPhone) reasons.push('phone is blank');
  else if (!PHONE_RE.test(phone)) reasons.push(`phone "${rawPhone}" is not a valid 10–13 digit number`);

  let plan = null;
  const planText = clean(values.plan);
  if (!planText) {
    plan = defaultPlanId ? plans.find((p) => p.id === Number(defaultPlanId)) : null;
    if (!plan) reasons.push('plan is blank');
    else warnings.push(`plan blank; used default "${plan.name}"`);
  } else {
    const key = planText.toLowerCase().replace(/\s+/g, ' ');
    plan = plans.find((p) => p.name.toLowerCase().replace(/\s+/g, ' ') === key) || plans.find((p) => String(p.id) === planText);
    if (!plan) reasons.push(`plan "${planText}" does not match any of your plans`);
    else if (!plan.is_active) reasons.push(`plan "${plan.name}" is retired`);
  }

  let startDate = null;
  const parsed = parseLooseDate(values.start_date);
  if (parsed.error) reasons.push(`start date ${parsed.error}`);
  else if (!parsed.date) {
    if (defaultStartDate) { startDate = defaultStartDate; warnings.push(`start date blank; used default ${defaultStartDate}`); }
    else reasons.push('start date is blank');
  } else {
    startDate = parsed.date;
    if (parsed.warning) warnings.push(parsed.warning);
  }

  if (reasons.length) return { ok: false, reasons };
  return { ok: true, value: { name, phone, address: clean(values.address).slice(0, 300), plan, start_date: startDate }, warnings };
}
