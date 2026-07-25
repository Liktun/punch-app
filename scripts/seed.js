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
const addBreak = db.prepare('INSERT INTO breaks (punch_id, break_in, break_out) VALUES (?, ?, ?)');
const hasPunch = db.prepare('SELECT COUNT(*) c FROM punches WHERE employee_id = ?');

const period = periodFor(new Date());
const base = period.start.getTime();
const H = 3600_000;

for (const e of employees) {
  const id = getId.get(e.username).id;
  if (hasPunch.get(id).c > 0) continue; // don't duplicate on re-run
  // Two completed shifts within the current period, each with a punched lunch break.
  const s1 = addPunch.run(id, new Date(base + 9 * H).toISOString(), new Date(base + 17 * H).toISOString());
  addBreak.run(s1.lastInsertRowid, new Date(base + 12 * H).toISOString(), new Date(base + 12.5 * H).toISOString());

  const day2 = base + 24 * H;
  const s2 = addPunch.run(id, new Date(day2 + 9 * H).toISOString(), new Date(day2 + 16.5 * H).toISOString());
  addBreak.run(s2.lastInsertRowid, new Date(day2 + 12 * H).toISOString(), new Date(day2 + 12.25 * H).toISOString());
}

console.log('[seed] demo employees + punches + pauses ready (marie/alex, mdp demo1234)');
