# Pointo — Web app de gestion des heures (beta)

Punch d'arrivée/départ des employés, calcul des heures travaillées par **période de paie bi-hebdomadaire**, déduction de pauses, heures supplémentaires, et vue admin avec corrections.

**Live** : https://fbtest02.com

---

## Fonctionnalités

- **Landing** : page d'accueil publique (nom + « Se connecter »).
- **Employé** : login/mot de passe, punch arrivée / départ, horloge + compteur en direct, total net de la période avec ventilation régulières / supp. / pauses.
- **Admin** :
  - Rapport par employé (régulières, supp., net) avec grand total, navigation entre périodes.
  - **Corrections d'oublis** : ajouter / éditer / supprimer un quart, avec validation (départ > arrivée, anti-chevauchement) et flag « modifié ».
  - Gestion des employés (créer, activer/désactiver).
- **Pauses** : déduction automatique (ex. quart > 6 h → −30 min), configurable via `.env`.
- **Heures supplémentaires** : au-delà de 40 h/semaine (Lun–Dim), calculées par semaine à l'intérieur de la période, affichées séparément (taux configurable).
- **Périodes de paie** : bi-hebdomadaires, alignées sur une date d'ancrage configurable (`.env`).

## Stack & choix

| Élément | Choix | Pourquoi |
|--------|-------|----------|
| Runtime | Node.js + Express | Léger, un seul process, déploiement simple |
| DB | SQLite (better-sqlite3, WAL) | Zéro service externe ; backup = copie de fichier ; suffisant pour une beta punch |
| Vues | EJS (server-rendered) | Pas de build front, pas de SPA inutile |
| Auth | express-session + bcrypt | Session cookie httpOnly ; hash bcrypt (coût 12) |
| Process manager | **systemd** | Reste up après déconnexion SSH et au reboot ; hardening natif |
| Reverse proxy | **Apache** (mod_proxy) → 127.0.0.1:3000 | Le VPS partage cPanel/Apache ; SSL Let's Encrypt |
| Redéploiement | GitHub Actions → SSH (`deploy.sh`) | `git pull` + `npm install` + `systemctl restart`, reproductible |

**Pourquoi login/mot de passe et pas un PIN** : chaque punch est attribué à un compte authentifié. Un PIN affiché dans une liste serait trivial à usurper. (Vrai anti-fraude — photo, géoloc, badge — hors scope beta.)

## Sécurité (beta)

- Secrets **hors du repo** : `.env` vit uniquement sur le serveur (`.gitignore`).
- `helmet` + CSP stricte (pas de script inline ; le JS client est servi en fichier statique).
- **CSRF** : jeton par session injecté dans chaque formulaire, vérifié sur tous les POST.
- Cookies `httpOnly`/`sameSite`/`secure`.
- **Rate limiting** sur `/login` (anti-brute-force).
- Validation/sanitization de tous les inputs (regex username, longueurs, etc.).
- Comparaison bcrypt même si l'utilisateur n'existe pas (anti-énumération par timing).
- App bindée sur `127.0.0.1` : joignable seulement via le reverse proxy.
- Requêtes SQL **paramétrées** (prepared statements) — pas d'injection.
- systemd durci (`NoNewPrivileges`, `ProtectSystem`, `ReadWritePaths` limité aux données).
- CI/CD : déploiement par **clé SSH dédiée** + user `punchdeploy` limité à un seul script via `sudo` (pas de root dans les secrets).

## Performance (mesuré, Phase 5)

- **Rapport admin** : une seule requête SQL groupée (JOIN + GROUP BY) au lieu d'une requête par employé → **N+1 éliminé**. Temps `/admin` ~8 ms.
- **Compression gzip** activée (`compression`) : page admin 2064 B → 874 B (-58 %).
- **Cache navigateur** sur les assets statiques (7 j) + ETag.
- Index SQLite sur `punches(employee_id, clock_in)` et sur les quarts ouverts.

## UX (Phase 4)

- Horloge en direct + compteur de durée du quart en cours (JS statique, compatible CSP).
- Confirmation avant chaque punch.
- Rapport admin : ligne **Total de la période** (grand total).
- Navigation « période suivante » désactivée quand on est déjà à la période courante.

## Edge cases gérés

- Double punch d'arrivée bloqué (quart déjà ouvert).
- Punch départ sans quart ouvert → message, pas d'erreur.
- Quart ouvert (départ oublié) : exclu des totaux, signalé « en cours ».
- Durée négative (horloge/skew) ramenée à 0.
- Session régénérée à la connexion (anti fixation) ; nouveau jeton CSRF après régénération.
- Employé désactivé pendant sa session → déconnecté.
- POST sans jeton CSRF valide → 403.

## Structure

```
src/server.js       routes, auth, logique punch, bootstrap admin
src/db.js           schéma SQLite + index
src/payperiod.js    calcul des périodes bi-hebdo
src/views/          EJS
src/public/         CSS
scripts/seed.js     données de démo
deploy/             systemd unit + deploy.sh
.github/workflows/  déploiement SSH
```

## Installation locale

```bash
npm install
cp .env.example .env   # éditer les valeurs
npm run seed           # (optionnel) données démo
npm start
```

## Déploiement VPS (résumé)

1. `git clone` dans `/opt/punch-app`, créer l'utilisateur système `punch`.
2. `npm install --omit=dev`, créer `/opt/punch-app/.env`.
3. Installer le unit systemd (`deploy/punch-app.service`), `systemctl enable --now punch-app`.
4. Vhost Apache reverse proxy `fbtest02.com` → `127.0.0.1:3000` + SSL.
5. Push sur `main` → GitHub Actions redéploie via SSH.

## Configuration (extraits `.env`)

```
BREAK_THRESHOLD_MIN=360     # au-delà de 6h -> pause déduite
BREAK_DEDUCTION_MIN=30      # minutes déduites (0 = désactivé)
OVERTIME_WEEKLY_HOURS=40    # seuil hebdo overtime
OVERTIME_RATE=1.5           # info d'affichage
PAY_PERIOD_ANCHOR=2026-01-05
PAY_PERIOD_DAYS=14
TZ=America/Toronto
```

## Tests

`node scripts/test-hours.js` — vérifie déduction de pause, overtime hebdomadaire, split correct par semaine.

## Ce que je ferais avec plus de temps

- Export CSV/PDF des périodes de paie.
- Arrondis configurables (5/15 min), gestion de pauses par punch explicite.
- Rôles multiples (gérants par équipe), audit log complet des corrections.
- Object cache (Valkey) si montée en charge ; migrations DB versionnées.
- Backups automatisés testés (cron `sqlite3 .backup` + rétention).
