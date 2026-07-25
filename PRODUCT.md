# Pointo

Web app de punch et de gestion des heures par période de paie, en français.

## Users & jobs

- **Employé** — punche son arrivée, ses pauses et son départ depuis un poste
  partagé ou son téléphone, souvent en vitesse en début et en fin de quart.
  Veut savoir en un coup d'œil s'il est *in* ou *out*, depuis combien de temps,
  et combien d'heures il a accumulées dans la période courante.
- **Administrateur** — consulte le rapport consolidé d'une période de paie,
  corrige les punchs manqués, gère les employés (créer, activer/désactiver) et
  choisit le thème visuel de l'application.

## Mechanism

- **Pauses punchées explicitement.** L'employé punche le début et la fin de
  chaque pause; le temps réel est déduit du quart. Aucune déduction
  automatique par seuil. Le départ est bloqué tant qu'une pause est ouverte.
- **Périodes de paie bi-hebdomadaires** alignées sur une date d'ancrage
  configurable.
- **Heures supplémentaires** au-delà de 40 h par semaine (lun–dim), calculées
  par semaine à l'intérieur de la période et affichées séparément.

## Terminology (French, user-facing)

Punch in / Punch out · Punch pause / Reprendre le travail · Quart · Période de
paie · Heures régulières · Heures supplémentaires (supp.) · Net · Pauses ·
Rapport des heures.

## Constraints

- **Platform:** web, server-rendered (Express + EJS). No SPA, no client
  framework, no build step for the front end.
- **CSP stricte:** `script-src 'self'`. Aucun script ni gestionnaire
  d'événement en ligne; tout JS client est servi en fichier statique.
- **Données réelles** rendues côté serveur: état du quart, pauses, totaux de
  période, historique, rapport admin. Aucune donnée factice dans les vues.
- **Sécurité:** sessions httpOnly, CSRF sur tous les POST, rate limiting sur la
  connexion, requêtes SQL paramétrées.
- **Déploiement:** VPS, systemd + reverse proxy Apache, redéploiement par
  GitHub Actions au push sur `main`.

## Brand commitments

- Le nom **Pointo** et le libellé « Point*o* » (dernière lettre en accent).
- L'interface reste **en français**.
- L'application propose **plusieurs thèmes visuels** interchangeables, choisis
  par l'administrateur et appliqués à tous les utilisateurs. Chaque thème est
  un monde visuel complet et autonome (feuille de style + vues dédiées), pas
  une simple variation de couleurs.

## Accessibility

Contraste suffisant sur fond clair comme foncé, `prefers-reduced-motion`
respecté, états de focus visibles, libellés de formulaire explicites.
