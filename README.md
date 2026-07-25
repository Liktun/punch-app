# Pointo — Time clock & hours management (beta)

Employees punch in and out, punch their own breaks, and the app computes worked
hours per **bi-weekly pay period**, splits regular vs. overtime, and gives
admins a report with correction tools.

**Live**: https://fbtest02.com

The user-facing interface is in **French**; this document is in English.

---

## Features

- **Landing** — public entry page (app name + sign in).
- **Employee** — username/password login, punch in / punch out, punch breaks,
  live clock and running counters, net total for the current period broken down
  into regular / overtime / breaks, and recent shift history.
- **Admin**
  - Report per employee (regular, overtime, net) with a grand total and
    navigation between pay periods.
  - **Missed-punch corrections**: add / edit / delete a shift, with validation
    (clock-out after clock-in, no overlap) and an "edited" flag plus note.
  - Employee management (create, activate/deactivate).
  - **Theme selector**: pick the app-wide visual theme and preview every screen.
- **Punched breaks** — the employee punches the start and end of each break.
  Actual break time is deducted from the shift; there is **no automatic
  deduction**. Punching out is blocked while a break is still open.
- **Overtime** — beyond 40 h/week (Mon–Sun), computed per week inside the
  period and displayed separately (rate configurable).
- **Pay periods** — bi-weekly, aligned on a configurable anchor date (`.env`).

## Themes

The app ships **7 complete visual worlds**. Each theme is a full stylesheet plus
its own set of views, not a colour variation — layout, type, components and
motion all change.

| Theme | World |
|---|---|
| Éditorial | Warm paper, halftone texture, serif + mono, signal red |
| Kronos | Obsidian and gold, orbital clock, starfield |
| Landscape | Layered ridgelines, earthy palette, frosted panels |
| Atelier | Cold slate night, fog bank, frosted glass, pale brass |
| Terminal | Dark technical grid, phosphor green, scanlines |
| Artifact | Near-black ground, monochrome red, heavy condensed caps |
| Cosmos | Pure black & white, interactive drifting starfield |

- **Only an admin can change the theme**, from the Report page. The choice is
  stored in the `settings` table and applies to every user.
- The theme bar also **previews each screen** (landing, login, employee, admin)
  in the selected theme without leaving the admin account.
- `revamp/` holds the original standalone mockups, served read-only at
  `/themes` for reference.

## Stack & decisions

| Piece | Choice | Why |
|---|---|---|
| Runtime | Node.js + Express | Light, single process, simple deployment |
| DB | SQLite (better-sqlite3, WAL) | No external service; backup = file copy; enough for a beta |
| Views | EJS (server-rendered) | No front-end build, no needless SPA |
| Auth | express-session + bcrypt | httpOnly session cookie; bcrypt cost 12 |
| Process manager | **systemd** | Survives SSH disconnect and reboot; native hardening |
| Reverse proxy | **Apache** (mod_proxy) → 127.0.0.1:3000 | The VPS already runs cPanel/Apache; Let's Encrypt SSL |
| Redeploy | GitHub Actions → SSH (`deploy.sh`) | `git pull` + `npm install` + `systemctl restart`, reproducible |

**Why login/password instead of a PIN**: every punch is attributed to an
authenticated account. A PIN shown in a list would be trivial to spoof. (Real
anti-fraud — photo, geolocation, badge — is out of scope for the beta.)

## Security

- Secrets **outside the repo**: `.env` lives only on the server (`.gitignore`).
- `helmet` + strict CSP (`script-src 'self'`) — no inline scripts or event
  handlers; all client JS is served as static files.
- **CSRF**: per-session token injected into every form, verified on all POSTs.
- Cookies `httpOnly` / `sameSite` / `secure`.
- **Rate limiting** on `/login` (anti brute-force).
- All inputs validated and sanitized (username regex, length caps).
- bcrypt comparison runs even when the user does not exist (blocks timing-based
  enumeration).
- App bound to `127.0.0.1`: reachable only through the reverse proxy.
- **Parameterized** SQL (prepared statements) — no injection.
- Hardened systemd unit (`NoNewPrivileges`, `ProtectSystem`, `ReadWritePaths`
  limited to the data directory).
- CI/CD deploys with a **dedicated SSH key** and a `punchdeploy` user restricted
  to a single script via `sudo` (no root credentials in secrets).
- Theme changes are admin-only and the value is validated against an allowlist.

## Performance

- **Admin report**: one grouped SQL query (JOIN + GROUP BY) instead of one query
  per employee → **N+1 eliminated**. `/admin` renders in ~8 ms. Breaks are
  loaded the same way, in a single query.
- **gzip compression** enabled: admin page 2064 B → 874 B (−58 %).
- **Browser caching** on static assets (7 days) + ETag, with a cache-busting
  asset version derived from the newest stylesheet mtime.
- SQLite indexes on `punches(employee_id, clock_in)`, on open shifts, and on
  `breaks(punch_id)`.

## UX

- Live clock plus running shift and break counters (static JS, CSP-safe).
- Confirmation before punching in or out.
- Admin report has a **period total** row.
- "Next period" is disabled when already on the current one.
- `prefers-reduced-motion` respected across all themes.

## Edge cases handled

- Double punch-in blocked (a shift is already open).
- Punch out with no open shift → message, not an error.
- **Punch out blocked while a break is open** — the break must be closed first.
- An open break counts as zero until it is closed.
- Break durations are clamped to their shift, so a bad correction can never
  push net time negative.
- Open shift (forgotten punch out): excluded from totals, flagged "en cours".
- Negative duration (clock skew) floored at 0.
- Session regenerated on login (anti-fixation); fresh CSRF token afterwards.
- Employee deactivated mid-session → logged out.
- POST without a valid CSRF token → 403.
- Unknown theme id → falls back to the default theme.

## Structure

```
src/server.js            routes, auth, punch logic, admin bootstrap
src/db.js                SQLite schema, migrations + indexes
src/hours.js             hours math: punched breaks + weekly overtime
src/payperiod.js         bi-weekly period computation
src/themes.js            theme catalog + persisted setting
src/views/themes/<id>/   per-theme views (landing, login, dashboard, admin)
src/views/               shared admin views (employees, detail, error, theme bar)
src/public/themes/       one stylesheet per theme
src/public/              shared assets (themebar.css, punch.css, dashboard.js)
revamp/                  original mockups, served at /themes
scripts/seed.js          demo data
scripts/test-hours.js    hours test suite
deploy/                  systemd unit + deploy.sh
.github/workflows/       SSH deployment
PRODUCT.md               durable product truth (users, mechanism, constraints)
```

## Local setup

```bash
npm install
cp .env.example .env   # edit the values
npm run seed           # optional demo data
npm start
```

Demo accounts after seeding: `marie` / `alex`, password `demo1234`.
The admin account comes from `ADMIN_USER` / `ADMIN_PASSWORD` in `.env`.

## VPS deployment (summary)

1. `git clone` into `/opt/punch-app`, create the `punch` system user.
2. `npm install --omit=dev`, create `/opt/punch-app/.env`.
3. Install the systemd unit (`deploy/punch-app.service`), then
   `systemctl enable --now punch-app`.
4. Apache vhost reverse-proxying `fbtest02.com` → `127.0.0.1:3000` + SSL.
5. Push to `main` → GitHub Actions redeploys over SSH.

Schema changes (the `breaks` and `settings` tables) are applied automatically on
boot, so no manual migration step is needed.

## Configuration (`.env` excerpt)

```
# Breaks are punched by the employee — nothing to configure.
OVERTIME_WEEKLY_HOURS=40    # weekly overtime threshold
OVERTIME_RATE=1.5           # display only
PAY_PERIOD_ANCHOR=2026-01-05
PAY_PERIOD_DAYS=14
TZ=America/Toronto
```

## Tests

`node scripts/test-hours.js` — covers punched breaks (single, multiple, still
open, out of bounds), weekly overtime and the correct per-week split.

## With more time

- CSV/PDF export of pay periods.
- Configurable rounding (5/15 min).
- Multiple roles (team managers), full audit log of corrections.
- Object cache (Valkey) if load grows; versioned DB migrations.
- Tested automated backups (cron `sqlite3 .backup` + retention).
