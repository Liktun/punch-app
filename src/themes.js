// Visual themes for the app. Each theme is one stylesheet in src/public/themes/
// that restyles every page; the markup never changes. The active theme is stored
// in the settings table and can only be changed by an admin.
import db from './db.js';

export const THEMES = [
  { id: 'editorial', label: 'Éditorial', hint: 'Papier chaud, serif, accent rouge' },
  { id: 'kronos',    label: 'Kronos',    hint: 'Obsidienne et or, sombre premium' },
  { id: 'landscape', label: 'Landscape', hint: 'Paysage naturel, palette terreuse' },
  { id: 'aurora',    label: 'Aurora',    hint: 'UI claire, indigo et violet' },
  { id: 'terminal',  label: 'Terminal',  hint: 'Terminal sombre, vert phosphore' },
  { id: 'artifact',  label: 'Artifact',  hint: 'Rouge monochrome, contraste fort' },
  { id: 'cosmos',    label: 'Cosmos',    hint: 'Noir et blanc, spatial' },
];

export const DEFAULT_THEME = 'editorial';
const VALID = new Set(THEMES.map((t) => t.id));

export function isValidTheme(id) {
  return VALID.has(id);
}

const readStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const writeStmt = db.prepare(
  `INSERT INTO settings (key, value, updated_at) VALUES ('theme', ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
);

export function getTheme() {
  const row = readStmt.get('theme');
  const id = row?.value;
  return isValidTheme(id) ? id : DEFAULT_THEME;
}

export function setTheme(id) {
  if (!isValidTheme(id)) return false;
  writeStmt.run(id);
  return true;
}
