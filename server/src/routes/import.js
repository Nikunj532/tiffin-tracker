import { Router } from 'express';
import { badRequest, h } from '../http.js';
import { isValidDate } from '../dates.js';
import { tx } from '../db.js';
import { cleanRecord, csvToRecords, isBlankRecord, mapHeader } from '../importer.js';

const MAX_ROWS = 5000;

/**
 * POST /api/import/customers
 *
 * Body (JSON), one of:
 *   { "csv": "name,phone,plan,start_date\n..." }
 *   { "rows": [ { "name": "...", "phone": "...", "plan": "...", "start_date": "..." }, ... ] }
 * or a raw text/csv body.
 *
 * Options (JSON body or query string): default_plan_id, default_start_date, dry_run.
 *
 * Every non-empty row ends up in exactly one bucket:
 *   imported – a clean subscription was created (customer created or reused)
 *   deduped  – phone repeats an earlier row, or the customer is already subscribed
 *   rejected – required data blank or unreadable (reasons listed)
 * Completely empty lines are ignored. The whole import is one transaction.
 */
export default function importRoutes(db) {
  const r = Router();

  r.post('/customers', h((req, res) => {
    const body = typeof req.body === 'string' ? { csv: req.body } : req.body || {};
    const opt = { ...req.query, ...body };
    const dryRun = opt.dry_run === true || opt.dry_run === 'true';
    const defaultStartDate = opt.default_start_date || null;
    if (defaultStartDate && !isValidDate(defaultStartDate)) throw badRequest('default_start_date must be YYYY-MM-DD');

    let records;
    let unknownHeaders = [];
    if (typeof body.csv === 'string') {
      const parsed = csvToRecords(body.csv);
      if (parsed.missingHeaders.length) {
        throw badRequest(`CSV header row must include ${parsed.missingHeaders.join(' and ')} columns`, { headers: 'Expected columns like: name, phone, address, plan, start_date' });
      }
      records = parsed.records;
      unknownHeaders = parsed.unknownHeaders;
    } else if (Array.isArray(body.rows)) {
      records = body.rows.map((values, i) => ({ row: i + 1, values: normaliseKeys(values) }));
    } else {
      throw badRequest('Send { csv: "..." } or { rows: [...] }');
    }
    if (records.length > MAX_ROWS) throw badRequest(`Import at most ${MAX_ROWS} rows at a time`);

    const plans = db.prepare('SELECT id, name, is_active FROM plans WHERE owner_id = ?').all(req.userId);
    if (opt.default_plan_id && !plans.some((p) => p.id === Number(opt.default_plan_id))) {
      throw badRequest('default_plan_id must reference one of your plans');
    }
    const ctx = { plans, defaultPlanId: opt.default_plan_id, defaultStartDate };

    const report = { imported: [], deduped: [], rejected: [] };
    let blankRows = 0;

    const findCustomer = db.prepare('SELECT * FROM customers WHERE owner_id = ? AND phone = ?');
    const runningSub = db.prepare('SELECT id, start_date FROM subscriptions WHERE customer_id = ? AND (end_date IS NULL OR end_date >= ?)');
    const insertCustomer = db.prepare('INSERT INTO customers (owner_id, name, phone, address) VALUES (?, ?, ?, ?)');
    const insertSub = db.prepare('INSERT INTO subscriptions (customer_id, plan_id, price_paise, start_date) VALUES (?, ?, ?, ?)');
    const planPrice = db.prepare('SELECT price_paise FROM plans WHERE id = ?');

    const run = () => {
      const seen = new Map(); // phone -> first row number that claimed it
      for (const { row, values } of records) {
        if (isBlankRecord(values)) { blankRows++; continue; }

        const result = cleanRecord(values, ctx);
        if (!result.ok) {
          report.rejected.push({ row, reasons: result.reasons, data: values });
          continue;
        }
        const v = result.value;

        if (seen.has(v.phone)) {
          report.deduped.push({ row, phone: v.phone, name: v.name, reason: `duplicate phone; kept row ${seen.get(v.phone)}`, duplicate_of_row: seen.get(v.phone) });
          continue;
        }
        seen.set(v.phone, row);

        const existing = findCustomer.get(req.userId, v.phone);
        if (existing) {
          const running = runningSub.get(existing.id, v.start_date);
          if (running) {
            report.deduped.push({ row, phone: v.phone, name: v.name, reason: `already a customer (${existing.name}) with a subscription running from ${running.start_date}`, customer_id: existing.id });
            continue;
          }
        }

        let customerId = existing?.id ?? null;
        let subscriptionId = null;
        if (!dryRun) {
          if (!existing) customerId = Number(insertCustomer.run(req.userId, v.name, v.phone, v.address).lastInsertRowid);
          subscriptionId = Number(insertSub.run(customerId, v.plan.id, planPrice.get(v.plan.id).price_paise, v.start_date).lastInsertRowid);
        }
        report.imported.push({
          row, customer_id: customerId, subscription_id: subscriptionId, name: existing?.name ?? v.name, phone: v.phone,
          plan: v.plan.name, start_date: v.start_date, customer: existing ? 'existing' : 'new', warnings: result.warnings,
        });
      }
    };

    if (dryRun) run(); else tx(db, run);

    res.status(dryRun ? 200 : 201).json({
      imported: report.imported.length,
      deduped: report.deduped.length,
      rejected: report.rejected.length,
      total_rows: records.length - blankRows,
      blank_rows_ignored: blankRows,
      dry_run: dryRun,
      unknown_columns: unknownHeaders,
      details: report,
    });
  }));

  return r;
}

/** Accept loosely named JSON keys ("Mobile No", "Start Date") using the CSV header aliases. */
function normaliseKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const field = mapHeader(k) ?? (k === 'start_date' ? 'start_date' : null);
    if (field && out[field] === undefined) out[field] = v;
  }
  return out;
}
