import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/punch.sqlite';

// Ensure the parent directory exists (kept outside the repo via .gitignore).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS punches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id  INTEGER NOT NULL,
    clock_in     TEXT NOT NULL,           -- ISO 8601 UTC
    clock_out    TEXT,                    -- ISO 8601 UTC, NULL = shift open
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_punches_emp      ON punches(employee_id);
  CREATE INDEX IF NOT EXISTS idx_punches_emp_in   ON punches(employee_id, clock_in);
  CREATE INDEX IF NOT EXISTS idx_punches_open     ON punches(employee_id) WHERE clock_out IS NULL;
`);

export default db;
