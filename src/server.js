import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import BetterSqlite3Store from 'better-sqlite3-session-store';
import Database from 'better-sqlite3';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import db from './db.js';
import { periodByOffset, periodFor, periodLabel } from './payperiod.js';

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
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

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
  punchesForEmpInRange: db.prepare(
    `SELECT * FROM punches
     WHERE employee_id = ? AND clock_in >= ? AND clock_in < ?
     ORDER BY clock_in ASC`
  ),
  recentPunches: db.prepare(
    `SELECT * FROM punches WHERE employee_id = ? ORDER BY clock_in DESC LIMIT 10`
  ),
  allActiveEmployees: db.prepare('SELECT * FROM employees WHERE active = 1 ORDER BY full_name'),
  allEmployees: db.prepare('SELECT * FROM employees ORDER BY active DESC, full_name'),
  insertEmployee: db.prepare(
    'INSERT INTO employees (username, full_name, password_hash, is_admin, active) VALUES (?, ?, ?, 0, 1)'
  ),
  setActive: db.prepare('UPDATE employees SET active = ? WHERE id = ? AND is_admin = 0'),
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

// Sum worked hours from punch rows within [start,end); open shifts excluded from totals but reported.
function summarize(punches) {
  let totalMs = 0;
  let openCount = 0;
  const rows = punches.map((p) => {
    const inD = new Date(p.clock_in);
    let ms = 0;
    if (p.clock_out) {
      ms = new Date(p.clock_out).getTime() - inD.getTime();
      if (ms < 0) ms = 0; // guard against clock skew / bad data
      totalMs += ms;
    } else {
      openCount += 1;
    }
    return { ...p, ms };
  });
  return { rows, totalMs, hours: totalMs / 3_600_000, openCount };
}

function fmtHours(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
}

// ---- Routes ----
app.get('/', (req, res) => {
  if (req.session.uid) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  if (req.session.uid) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

app.post('/login', loginLimiter, (req, res) => {
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
    res.redirect(user.is_admin ? '/admin' : '/dashboard');
  });
});

app.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Employee dashboard: punch in/out + recent history + current period total.
app.get('/dashboard', requireAuth, (req, res) => {
  if (req.user.is_admin) return res.redirect('/admin');
  const open = q.openPunch.get(req.user.id);
  const period = periodFor(new Date());
  const punches = q.punchesForEmpInRange.all(req.user.id, period.start.toISOString(), period.end.toISOString());
  const summary = summarize(punches);
  const recent = q.recentPunches.all(req.user.id);
  res.render('dashboard', {
    user: req.user,
    open,
    periodLabel: periodLabel(period),
    periodTotal: fmtHours(summary.totalMs),
    recent,
    fmtTime,
    fmtHours,
    flash: req.session.flash || null,
  });
  req.session.flash = null;
});

app.post('/punch/in', requireAuth, (req, res) => {
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

app.post('/punch/out', requireAuth, (req, res) => {
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
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const offset = parseInt(req.query.p || '0', 10) || 0;
  const period = periodByOffset(offset);
  const employees = q.allActiveEmployees.all().filter((e) => !e.is_admin);
  const report = employees.map((e) => {
    const punches = q.punchesForEmpInRange.all(e.id, period.start.toISOString(), period.end.toISOString());
    const s = summarize(punches);
    return {
      id: e.id,
      name: e.full_name,
      username: e.username,
      hours: fmtHours(s.totalMs),
      openCount: s.openCount,
      shifts: s.rows.length,
    };
  });
  res.render('admin', {
    user: req.user,
    period,
    periodLabel: periodLabel(period),
    offset,
    report,
    flash: req.session.flash || null,
  });
  req.session.flash = null;
});

// Admin: detail of one employee for the selected period.
app.get('/admin/employee/:id', requireAuth, requireAdmin, (req, res) => {
  const emp = q.userById.get(parseInt(req.params.id, 10));
  if (!emp) return res.status(404).render('error', { message: 'Employé introuvable.' });
  const offset = parseInt(req.query.p || '0', 10) || 0;
  const period = periodByOffset(offset);
  const punches = q.punchesForEmpInRange.all(emp.id, period.start.toISOString(), period.end.toISOString());
  const s = summarize(punches);
  res.render('employee_detail', {
    user: req.user,
    emp,
    period,
    periodLabel: periodLabel(period),
    offset,
    rows: s.rows,
    total: fmtHours(s.totalMs),
    fmtTime,
    fmtHours,
  });
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

app.post('/admin/employees', requireAuth, requireAdmin, (req, res) => {
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

app.post('/admin/employees/:id/toggle', requireAuth, requireAdmin, (req, res) => {
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
