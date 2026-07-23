// Worked-hours math: per-shift break deduction + weekly overtime split.
// Kept pure & unit-testable; no DB access here.

const BREAK_THRESHOLD_MIN = parseInt(process.env.BREAK_THRESHOLD_MIN || '360', 10);
const BREAK_DEDUCTION_MIN = parseInt(process.env.BREAK_DEDUCTION_MIN || '30', 10);
const OT_WEEKLY_HOURS = parseFloat(process.env.OVERTIME_WEEKLY_HOURS || '40');
export const OT_RATE = parseFloat(process.env.OVERTIME_RATE || '1.5');

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Net worked ms for one shift after auto break deduction.
 * Open shifts (no clock_out) return 0 and are reported separately.
 * @param {{clock_in:string, clock_out:string|null}} p
 * @returns {{grossMs:number, breakMs:number, netMs:number, open:boolean}}
 */
export function shiftNet(p) {
  if (!p.clock_out) return { grossMs: 0, breakMs: 0, netMs: 0, open: true };
  let gross = new Date(p.clock_out).getTime() - new Date(p.clock_in).getTime();
  if (gross < 0) gross = 0; // clock skew guard
  let breakMs = 0;
  if (BREAK_DEDUCTION_MIN > 0 && gross > BREAK_THRESHOLD_MIN * MS_PER_MIN) {
    breakMs = Math.min(BREAK_DEDUCTION_MIN * MS_PER_MIN, gross); // never negative
  }
  return { grossMs: gross, breakMs, netMs: gross - breakMs, open: false };
}

// ISO week key (Mon-based) in the configured TZ. Uses local date parts.
function weekKey(d) {
  const date = new Date(d);
  // Shift to Monday-based day index (Mon=0..Sun=6)
  const day = (date.getDay() + 6) % 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - day);
  return `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
}

/**
 * Aggregate a list of punches into totals with weekly overtime split.
 * @param {Array} punches rows with clock_in/clock_out
 * @returns {{
 *   netMs:number, breakMs:number, grossMs:number,
 *   regularMs:number, overtimeMs:number,
 *   shifts:number, openCount:number
 * }}
 */
export function aggregate(punches) {
  let netMs = 0, breakMs = 0, grossMs = 0, openCount = 0, shifts = 0;
  const perWeek = new Map(); // weekKey -> net ms that week

  for (const p of punches) {
    const s = shiftNet(p);
    shifts += 1;
    if (s.open) { openCount += 1; continue; }
    grossMs += s.grossMs;
    breakMs += s.breakMs;
    netMs += s.netMs;
    const wk = weekKey(p.clock_in);
    perWeek.set(wk, (perWeek.get(wk) || 0) + s.netMs);
  }

  // Overtime = sum over weeks of max(0, weekNet - 40h)
  const otThresholdMs = OT_WEEKLY_HOURS * MS_PER_HOUR;
  let overtimeMs = 0;
  for (const wkMs of perWeek.values()) {
    if (wkMs > otThresholdMs) overtimeMs += wkMs - otThresholdMs;
  }
  const regularMs = netMs - overtimeMs;

  return { netMs, breakMs, grossMs, regularMs, overtimeMs, shifts, openCount };
}

export function fmtHours(ms) {
  const totalMin = Math.round(ms / MS_PER_MIN);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}
