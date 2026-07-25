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

  -- Breaks are punched explicitly by the employee and belong to one shift.
  CREATE TABLE IF NOT EXISTS breaks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    punch_id     INTEGER NOT NULL,
    break_in     TEXT NOT NULL,           -- ISO 8601 UTC
    break_out    TEXT,                    -- ISO 8601 UTC, NULL = break in progress
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (punch_id) REFERENCES punches(id) ON DELETE CASCADE
  );

  -- Simple key/value app settings (e.g. the active visual theme).
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_punches_emp      ON punches(employee_id);
  CREATE INDEX IF NOT EXISTS idx_punches_emp_in   ON punches(employee_id, clock_in);
  CREATE INDEX IF NOT EXISTS idx_punches_open     ON punches(employee_id) WHERE clock_out IS NULL;
  CREATE INDEX IF NOT EXISTS idx_breaks_punch     ON breaks(punch_id);
  CREATE INDEX IF NOT EXISTS idx_breaks_open      ON breaks(punch_id) WHERE break_out IS NULL;
`);

// ---- Lightweight migrations (add columns if missing) ----
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}
if (!columnExists('punches', 'edited_by_admin')) {
  db.exec("ALTER TABLE punches ADD COLUMN edited_by_admin INTEGER NOT NULL DEFAULT 0");
}
if (!columnExists('punches', 'note')) {
  db.exec("ALTER TABLE punches ADD COLUMN note TEXT");
}

export default db;
