import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db from '../src/db.js';
import { periodFor } from '../src/payperiod.js';

// Idempotent-ish demo seed: two employees + a couple of punches in the current period.
const employees = [
  { username: 'marie', full_name: 'Marie Tremblay', password: 'demo1234' },
  { username: 'alex', full_name: 'Alex Gagnon', password: 'demo1234' },
];

const insert = db.prepare(
  'INSERT OR IGNORE INTO employees (username, full_name, password_hash, is_admin, active) VALUES (?, ?, ?, 0, 1)'
);
for (const e of employees) {
  insert.run(e.username, e.full_name, bcrypt.hashSync(e.password, 12));
}

const getId = db.prepare('SELECT id FROM employees WHERE username = ?');
const addPunch = db.prepare('INSERT INTO punches (employee_id, clock_in, clock_out) VALUES (?, ?, ?)');
const hasPunch = db.prepare('SELECT COUNT(*) c FROM punches WHERE employee_id = ?');

const period = periodFor(new Date());
const base = period.start.getTime();
const H = 3600_000;

for (const e of employees) {
  const id = getId.get(e.username).id;
  if (hasPunch.get(id).c > 0) continue; // don't duplicate on re-run
  // Two completed shifts within the current period.
  addPunch.run(id, new Date(base + 9 * H).toISOString(), new Date(base + 17 * H).toISOString());
  addPunch.run(id, new Date(base + 24 * H + 9 * H).toISOString(), new Date(base + 24 * H + 16.5 * H).toISOString());
}

console.log('[seed] demo employees + punches ready (marie/alex, mdp demo1234)');
