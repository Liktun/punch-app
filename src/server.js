import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import BetterSqlite3Store from 'better-sqlite3-session-store';
import Database from 'better-sqlite3';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import db from './db.js';
import { periodByOffset, periodFor, periodLabel } from './payperiod.js';
import { aggregate, shiftNet, fmtHours as fmtHoursH, OT_RATE } from './hours.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Behind Apache/nginx reverse proxy: trust first proxy for secure cookies & IPs.
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));
app.use(compression()); // gzip responses (Phase 5)
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',           // cache static assets in the browser
  etag: true,
}));

const SqliteStore = BetterSqlite3Store(session);
const sessDir = path.dirname(process.env.DB_PATH || './data/punch.sqlite');
fs.mkdirSync(sessDir, { recursive: true });
const sessionDb = new Database(path.join(sessDir, 'sessions.sqlite'));

app.use(session({
  store: new SqliteStore({ client: sessionDb, expired: { clear: true, intervalMs: 900000 } }),
  secret: process.env.SESSION_SECRET || 'insecure-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8, // 8h
  },
}));

// ---- CSRF protection (double-submit token in session) ----
// Lightweight, no extra dependency: token stored in session, injected into forms,
// verified on every state-changing POST.
app.use((req, res, next) => {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrf = req.session.csrf;
  next();
});
function verifyCsrf(req, res, next) {
  const token = req.body?._csrf;
  if (!token || token !== req.session.csrf) {
    return res.status(403).render('error', { message: 'Jeton de sécurité invalide. Recharge la page et réessaie.' });
  }
  next();
}

// ---- Rate limiting on auth to slow brute force ----
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de tentatives. Réessaie dans quelques minutes.',
});

// ---- Prepared statements ----
const q = {
  userByName: db.prepare('SELECT * FROM employees WHERE username = ? AND active = 1'),
  userById: db.prepare('SELECT * FROM employees WHERE id = ?'),
  openPunch: db.prepare('SELECT * FROM punches WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'),
  insertPunch: db.prepare('INSERT INTO punches (employee_id, clock_in) VALUES (?, ?)'),
  closePunch: db.prepare('UPDATE punches SET clock_out = ? WHERE id = ? AND clock_out IS NULL'),
  punchById: db.prepare('SELECT * FROM punches WHERE id = ?'),
  punchesForEmpInRange: db.prepare(
    `SELECT * FROM punches
     WHERE employee_id = ? AND clock_in >= ? AND clock_in < ?
     ORDER BY clock_in ASC`
  ),
  // All punches for all active non-admin employees in one range (single query -> no N+1).
  punchesInRange: db.prepare(
    `SELECT p.* FROM punches p
     JOIN employees e ON e.id = p.employee_id
     WHERE e.active = 1 AND e.is_admin = 0
       AND p.clock_in >= ? AND p.clock_in < ?
     ORDER BY p.clock_in ASC`
  ),
  recentPunches: db.prepare(
    `SELECT * FROM punches WHERE employee_id = ? ORDER BY clock_in DESC LIMIT 10`
  ),
  allActiveEmployees: db.prepare('SELECT * FROM employees WHERE active = 1 AND is_admin = 0 ORDER BY full_name'),
  allEmployees: db.prepare('SELECT * FROM employees ORDER BY active DESC, full_name'),
  insertEmployee: db.prepare(
    'INSERT INTO employees (username, full_name, password_hash, is_admin, active) VALUES (?, ?, ?, 0, 1)'
  ),
  setActive: db.prepare('UPDATE employees SET active = ? WHERE id = ? AND is_admin = 0'),
  // Admin corrections (CRUD)
  insertPunchFull: db.prepare(
    'INSERT INTO punches (employee_id, clock_in, clock_out, edited_by_admin, note) VALUES (?, ?, ?, 1, ?)'
  ),
  updatePunch: db.prepare(
    'UPDATE punches SET clock_in = ?, clock_out = ?, edited_by_admin = 1, note = ? WHERE id = ?'
  ),
  deletePunch: db.prepare('DELETE FROM punches WHERE id = ?'),
  overlapCount: db.prepare(
    // Count punches for this employee that overlap [in,out), excluding a given id.
    `SELECT COUNT(*) c FROM punches
     WHERE employee_id = ? AND id != ?
       AND clock_out IS NOT NULL
       AND clock_in < ? AND clock_out > ?`
  ),
};

// ---- Helpers ----
function requireAuth(req, res, next) {
  if (!req.session.uid) return res.redirect('/login');
  const user = q.userById.get(req.session.uid);
  if (!user || !user.active) { req.session.destroy(() => {}); return res.redirect('/login'); }
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).render('error', { message: 'Accès réservé à l\'administrateur.' });
  next();
}

// ---- Helpers ----
const fmtHours = fmtHoursH; // from hours.js (single source of truth)

// Build per-row detail (gross/break/net) + totals for a set of punches.
function detailRows(punches) {
  return punches.map((p) => {
    const s = shiftNet(p);
    return { ...p, grossMs: s.grossMs, breakMs: s.breakMs, netMs: s.netMs, open: s.open };
  });
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
}
// Format an ISO instant into a value usable by <input type="datetime-local"> (local time).
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
// Parse a datetime-local string (local) into an ISO UTC string; returns null if invalid.
function parseLocalInput(v) {
  if (!v) return null;
  const d = new Date(v); // interpreted as local time
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- Routes ----
// Landing page (public). Authenticated users skip straight to their area.
app.get('/', (req, res) => {
  if (req.session.uid) {
    const u = q.userById.get(req.session.uid);
    if (u) return res.redirect(u.is_admin ? '/admin' : '/dashboard');
  }
  res.render('landing');
});

app.get('/login', (req, res) => {
  if (req.session.uid) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', loginLimiter, verifyCsrf, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) {
    return res.status(400).render('login', { error: 'Nom d\'utilisateur et mot de passe requis.' });
  }
  const user = q.userByName.get(username);
  // Constant-ish behaviour: always run a hash compare to avoid user enumeration timing.
  const hash = user ? user.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
  const ok = bcrypt.compareSync(password, hash);
  if (!user || !ok) {
    return res.status(401).render('login', { error: 'Identifiants invalides.' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { error: 'Erreur de session.' });
    req.session.uid = user.id;
    req.session.csrf = crypto.randomBytes(24).toString('hex'); // fresh token after regenerate
    res.redirect(user.is_admin ? '/admin' : '/dashboard');
  });
});

app.post('/logout', requireAuth, verifyCsrf, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Employee dashboard: punch in/out + recent history + current period total.
app.get('/dashboard', requireAuth, (req, res) => {
  if (req.user.is_admin) return res.redirect('/admin');
  const open = q.openPunch.get(req.user.id);
  const period = periodFor(new Date());
  const punches = q.punchesForEmpInRange.all(req.user.id, period.start.toISOString(), period.end.toISOString());
  const agg = aggregate(punches);
  const recent = q.recentPunches.all(req.user.id);
  res.render('dashboard', {
    user: req.user,
    open,
    periodLabel: periodLabel(period),
    periodNet: fmtHours(agg.netMs),
    periodRegular: fmtHours(agg.regularMs),
    periodOvertime: fmtHours(agg.overtimeMs),
    periodBreak: fmtHours(agg.breakMs),
    hasOvertime: agg.overtimeMs > 0,
    recent,
    fmtTime,
    fmtHours,
    flash: req.session.flash || null,
  });
  req.session.flash = null;
});

app.post('/punch/in', requireAuth, verifyCsrf, (req, res) => {
  if (req.user.is_admin) return res.redirect('/admin');
  const open = q.openPunch.get(req.user.id);
  if (open) {
    req.session.flash = { type: 'warn', msg: 'Tu as déjà un quart en cours. Punch ton départ d\'abord.' };
    return res.redirect('/dashboard');
  }
  q.insertPunch.run(req.user.id, new Date().toISOString());
  req.session.flash = { type: 'ok', msg: 'Arrivée enregistrée.' };
  res.redirect('/dashboard');
});

app.post('/punch/out', requireAuth, verifyCsrf, (req, res) => {
  if (req.user.is_admin) return res.redirect('/admin');
  const open = q.openPunch.get(req.user.id);
  if (!open) {
    req.session.flash = { type: 'warn', msg: 'Aucun quart en cours à fermer.' };
    return res.redirect('/dashboard');
  }
  q.closePunch.run(new Date().toISOString(), open.id);
  req.session.flash = { type: 'ok', msg: 'Départ enregistré.' };
  res.redirect('/dashboard');
});

// Admin: totals per employee for a selected pay period.
// One query fetches all punches in range; aggregation (breaks + weekly OT) done in JS, grouped by employee. No N+1.
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const offset = parseInt(req.query.p || '0', 10) || 0;
  const period = periodByOffset(offset);
  const employees = q.allActiveEmployees.all();
  const allPunches = q.punchesInRange.all(period.start.toISOString(), period.end.toISOString());
  const byEmp = new Map();
  for (const p of allPunches) {
    if (!byEmp.has(p.employee_id)) byEmp.set(p.employee_id, []);
    byEmp.get(p.employee_id).push(p);
  }
  let grandNet = 0, grandReg = 0, grandOt = 0;
  const report = employees.map((e) => {
    const agg = aggregate(byEmp.get(e.id) || []);
    grandNet += agg.netMs; grandReg += agg.regularMs; grandOt += agg.overtimeMs;
    return {
      id: e.id,
      name: e.full_name,
      username: e.username,
      net: fmtHours(agg.netMs),
      regular: fmtHours(agg.regularMs),
      overtime: fmtHours(agg.overtimeMs),
      hasOt: agg.overtimeMs > 0,
      openCount: agg.openCount,
      shifts: agg.shifts,
    };
  });
  res.render('admin', {
    user: req.user,
    period,
    periodLabel: periodLabel(period),
    offset,
    report,
    grandNet: fmtHours(grandNet),
    grandReg: fmtHours(grandReg),
    grandOt: fmtHours(grandOt),
    otRate: OT_RATE,
    flash: req.session.flash || null,
  });
  req.session.flash = null;
});

// Admin: detail of one employee for the selected period (with correction controls).
app.get('/admin/employee/:id', requireAuth, requireAdmin, (req, res) => {
  const emp = q.userById.get(parseInt(req.params.id, 10));
  if (!emp) return res.status(404).render('error', { message: 'Employé introuvable.' });
  const offset = parseInt(req.query.p || '0', 10) || 0;
  const period = periodByOffset(offset);
  const punches = q.punchesForEmpInRange.all(emp.id, period.start.toISOString(), period.end.toISOString());
  const agg = aggregate(punches);
  res.render('employee_detail', {
    user: req.user,
    emp,
    period,
    periodLabel: periodLabel(period),
    offset,
    rows: detailRows(punches),
    net: fmtHours(agg.netMs),
    regular: fmtHours(agg.regularMs),
    overtime: fmtHours(agg.overtimeMs),
    breakTotal: fmtHours(agg.breakMs),
    hasOt: agg.overtimeMs > 0,
    otRate: OT_RATE,
    fmtTime,
    fmtHours,
    toLocalInput,
    flash: req.session.flash || null,
  });
  req.session.flash = null;
});

// Admin corrections: add / edit / delete a punch.
function validatePunchTimes(inIso, outIso) {
  if (!inIso) return 'Heure d\'arrivée invalide.';
  if (outIso !== null) {
    if (new Date(outIso).getTime() <= new Date(inIso).getTime()) {
      return 'Le départ doit être après l\'arrivée.';
    }
  }
  return null;
}

app.post('/admin/employee/:id/punch/add', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const emp = q.userById.get(parseInt(req.params.id, 10));
  if (!emp) return res.status(404).render('error', { message: 'Employé introuvable.' });
  const offset = parseInt(req.body.p || '0', 10) || 0;
  const inIso = parseLocalInput(req.body.clock_in);
  const outIso = req.body.clock_out ? parseLocalInput(req.body.clock_out) : null;
  const note = String(req.body.note || '').slice(0, 200) || null;
  const err = validatePunchTimes(inIso, outIso);
  if (err) { req.session.flash = { type: 'warn', msg: err }; return res.redirect(`/admin/employee/${emp.id}?p=${offset}`); }
  if (outIso && q.overlapCount.get(emp.id, 0, outIso, inIso).c > 0) {
    req.session.flash = { type: 'warn', msg: 'Ce quart en chevauche un autre existant.' };
    return res.redirect(`/admin/employee/${emp.id}?p=${offset}`);
  }
  q.insertPunchFull.run(emp.id, inIso, outIso, note);
  req.session.flash = { type: 'ok', msg: 'Quart ajouté.' };
  res.redirect(`/admin/employee/${emp.id}?p=${offset}`);
});

app.post('/admin/punch/:pid/edit', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const punch = q.punchById.get(parseInt(req.params.pid, 10));
  if (!punch) return res.status(404).render('error', { message: 'Quart introuvable.' });
  const offset = parseInt(req.body.p || '0', 10) || 0;
  const inIso = parseLocalInput(req.body.clock_in);
  const outIso = req.body.clock_out ? parseLocalInput(req.body.clock_out) : null;
  const note = String(req.body.note || '').slice(0, 200) || null;
  const err = validatePunchTimes(inIso, outIso);
  if (err) { req.session.flash = { type: 'warn', msg: err }; return res.redirect(`/admin/employee/${punch.employee_id}?p=${offset}`); }
  if (outIso && q.overlapCount.get(punch.employee_id, punch.id, outIso, inIso).c > 0) {
    req.session.flash = { type: 'warn', msg: 'Ce quart en chevauche un autre existant.' };
    return res.redirect(`/admin/employee/${punch.employee_id}?p=${offset}`);
  }
  q.updatePunch.run(inIso, outIso, note, punch.id);
  req.session.flash = { type: 'ok', msg: 'Quart modifié.' };
  res.redirect(`/admin/employee/${punch.employee_id}?p=${offset}`);
});

app.post('/admin/punch/:pid/delete', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const punch = q.punchById.get(parseInt(req.params.pid, 10));
  if (!punch) return res.status(404).render('error', { message: 'Quart introuvable.' });
  const offset = parseInt(req.body.p || '0', 10) || 0;
  q.deletePunch.run(punch.id);
  req.session.flash = { type: 'ok', msg: 'Quart supprimé.' };
  res.redirect(`/admin/employee/${punch.employee_id}?p=${offset}`);
});

// Admin: manage employees.
app.get('/admin/employees', requireAuth, requireAdmin, (req, res) => {
  res.render('employees', {
    user: req.user,
    employees: q.allEmployees.all(),
    flash: req.session.flash || null,
    error: null,
  });
  req.session.flash = null;
});

app.post('/admin/employees', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const fullName = String(req.body.full_name || '').trim();
  const password = String(req.body.password || '');
  const render = (error) => res.status(400).render('employees', {
    user: req.user, employees: q.allEmployees.all(), flash: null, error,
  });
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return render('Nom d\'utilisateur invalide (3-32, a-z 0-9 . _ -).');
  if (fullName.length < 2 || fullName.length > 80) return render('Nom complet invalide.');
  if (password.length < 8) return render('Mot de passe : minimum 8 caractères.');
  if (q.userByName.get(username)) return render('Ce nom d\'utilisateur existe déjà.');
  const hash = bcrypt.hashSync(password, 12);
  try {
    q.insertEmployee.run(username, fullName, hash);
  } catch {
    return render('Impossible de créer l\'employé (doublon ?).');
  }
  req.session.flash = { type: 'ok', msg: `Employé ${fullName} créé.` };
  res.redirect('/admin/employees');
});

app.post('/admin/employees/:id/toggle', requireAuth, requireAdmin, verifyCsrf, (req, res) => {
  const emp = q.userById.get(parseInt(req.params.id, 10));
  if (emp && !emp.is_admin) q.setActive.run(emp.active ? 0 : 1, emp.id);
  req.session.flash = { type: 'ok', msg: 'Statut mis à jour.' };
  res.redirect('/admin/employees');
});

// Health check for monitoring / reverse proxy.
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use((req, res) => res.status(404).render('error', { message: 'Page introuvable.' }));

// ---- Bootstrap admin from env, then listen ----
function ensureAdmin() {
  const user = (process.env.ADMIN_USER || 'admin').trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) { console.warn('[warn] ADMIN_PASSWORD not set — admin not provisioned.'); return; }
  const existing = db.prepare('SELECT * FROM employees WHERE username = ?').get(user);
  const hash = bcrypt.hashSync(pass, 12);
  if (existing) {
    db.prepare('UPDATE employees SET password_hash = ?, is_admin = 1, active = 1 WHERE id = ?').run(hash, existing.id);
  } else {
    db.prepare('INSERT INTO employees (username, full_name, password_hash, is_admin, active) VALUES (?, ?, ?, 1, 1)')
      .run(user, 'Administrateur', hash);
  }
  console.log(`[ok] admin ready: ${user}`);
}

ensureAdmin();
app.listen(PORT, '127.0.0.1', () => {
  console.log(`punch-app listening on 127.0.0.1:${PORT}`);
});
