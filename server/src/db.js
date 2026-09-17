import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_paise INTEGER NOT NULL CHECK (price_paise > 0),
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_customers_owner_name ON customers(owner_id, name);

-- price_paise is copied from the plan at subscribe time so later plan price
-- changes do not silently change existing customers' bills.
CREATE TABLE IF NOT EXISTS subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plan_id     INTEGER NOT NULL REFERENCES plans(id),
  price_paise INTEGER NOT NULL,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(customer_id);

-- end_date is inclusive (last paused day); NULL means paused until resumed.
CREATE TABLE IF NOT EXISTS pauses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  reason          TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pauses_sub ON pauses(subscription_id, start_date);

-- Snapshot of a generated bill, so past invoices stay stable.
CREATE TABLE IF NOT EXISTS bills (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  month           TEXT NOT NULL,
  working_days    INTEGER NOT NULL,
  subscribed_days INTEGER NOT NULL,
  paused_days     INTEGER NOT NULL,
  delivered_days  INTEGER NOT NULL,
  price_paise     INTEGER NOT NULL,
  amount_paise    INTEGER NOT NULL,
  generated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subscription_id, month)
);
`;

export function openDb(file = process.env.DB_FILE || path.resolve('data', 'tiffin.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive changes for databases created before these features existed. */
function migrate(db) {
  const subCols = db.prepare('PRAGMA table_info(subscriptions)').all().map((c) => c.name);
  if (!subCols.includes('transferred_from_id')) {
    db.exec('ALTER TABLE subscriptions ADD COLUMN transferred_from_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL');
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_subs_transferred_from ON subscriptions(transferred_from_id);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Every message handed to the Notification Service. dedupe_key makes
    -- sends idempotent (e.g. one delivery reminder per subscription per day).
    CREATE TABLE IF NOT EXISTS outbox (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id        INTEGER REFERENCES users(id) ON DELETE CASCADE,
      customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
      channel         TEXT NOT NULL DEFAULT 'sms',
      recipient       TEXT NOT NULL,
      type            TEXT NOT NULL,
      for_date        TEXT,
      message         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'sent',
      dedupe_key      TEXT UNIQUE,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_date ON outbox(for_date, type);
    CREATE INDEX IF NOT EXISTS idx_outbox_owner ON outbox(owner_id, id);

    -- One row per simulated morning that has been processed.
    CREATE TABLE IF NOT EXISTS clock_runs (
      date     TEXT PRIMARY KEY,
      due      INTEGER NOT NULL,
      notified INTEGER NOT NULL,
      ran_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/** Run fn inside a transaction. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
