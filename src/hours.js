// Worked-hours math: per-shift break deduction + weekly overtime split.
// Kept pure & unit-testable; no DB access here.

const OT_WEEKLY_HOURS = parseFloat(process.env.OVERTIME_WEEKLY_HOURS || '40');
export const OT_RATE = parseFloat(process.env.OVERTIME_RATE || '1.5');

const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Total ms of the breaks punched during a shift.
 * A break still in progress (no break_out) counts as 0 until it is closed.
 * Durations are clamped to the shift window so an out-of-range correction can
 * never push net time negative.
 * @param {Array<{break_in:string, break_out:string|null}>} breaks
 * @param {number} shiftStart epoch ms
 * @param {number} shiftEnd epoch ms
 */
export function breaksTotal(breaks, shiftStart, shiftEnd) {
  if (!breaks || !breaks.length) return 0;
  let total = 0;
  for (const b of breaks) {
    if (!b.break_out) continue; // open break: not counted yet
    let start = new Date(b.break_in).getTime();
    let end = new Date(b.break_out).getTime();
    if (!(end > start)) continue; // skew / invalid guard
    // Clamp into the shift so totals stay consistent.
    if (Number.isFinite(shiftStart)) start = Math.max(start, shiftStart);
    if (Number.isFinite(shiftEnd)) end = Math.min(end, shiftEnd);
    if (end > start) total += end - start;
  }
  return total;
}

/**
 * Net worked ms for one shift = gross minus the breaks the employee punched.
 * Open shifts (no clock_out) return 0 and are reported separately.
 * @param {{clock_in:string, clock_out:string|null, breaks?:Array}} p
 * @returns {{grossMs:number, breakMs:number, netMs:number, open:boolean}}
 */
export function shiftNet(p) {
  if (!p.clock_out) return { grossMs: 0, breakMs: 0, netMs: 0, open: true };
  const start = new Date(p.clock_in).getTime();
  const end = new Date(p.clock_out).getTime();
  let gross = end - start;
  if (gross < 0) gross = 0; // clock skew guard
  const breakMs = Math.min(breaksTotal(p.breaks, start, end), gross);
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
