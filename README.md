# Punch — Web app de gestion des heures (beta)

Punch d'arrivée/départ des employés, calcul des heures travaillées par **période de paie bi-hebdomadaire**, et vue admin avec les totaux par employé.

**Live** : https://fbtest02.com

---

## Fonctionnalités

- **Employé** : login/mot de passe, punch arrivée / départ, total de la période courante, historique récent.
- **Admin** : rapport des heures par employé pour une période de paie (navigation période précédente/suivante), détail par employé, gestion des employés (créer, activer/désactiver).
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

## Ce que je ferais avec plus de temps

- Édition/suppression de punchs côté admin + correction manuelle des oublis.
- Export CSV/PDF des périodes de paie.
- Gestion des pauses, heures supp., arrondis configurables.
- Rôles multiples (gérants par équipe), audit log.
- Object cache (Valkey) si montée en charge ; migrations DB versionnées.
- Backups automatisés testés (cron `sqlite3 .backup` + rétention).
- Tests automatisés (calcul des périodes, edge cases punch).
