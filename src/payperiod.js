// Bi-weekly pay period math.
// A pay period is PAY_PERIOD_DAYS long, aligned to PAY_PERIOD_ANCHOR (local date).
// All boundaries are computed in the configured TZ, then compared as UTC instants.

const ANCHOR = process.env.PAY_PERIOD_ANCHOR || '2026-01-05';
const PERIOD_DAYS = parseInt(process.env.PAY_PERIOD_DAYS || '14', 10);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Anchor at local midnight. We treat dates as calendar days; DST edge cases are
// acceptable for a beta (periods are 14 days so a 1h DST shift never crosses a day).
function anchorMs() {
  // Parse YYYY-MM-DD as local midnight.
  const [y, m, d] = ANCHOR.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/**
 * Return the pay period (start inclusive, end exclusive) containing `date`.
 * @param {Date} date
 * @returns {{index:number, start:Date, end:Date}}
 */
export function periodFor(date = new Date()) {
  const a = anchorMs();
  const t = date.getTime();
  const periodMs = PERIOD_DAYS * MS_PER_DAY;
  // Floor division so periods before the anchor also work.
  const index = Math.floor((t - a) / periodMs);
  const start = new Date(a + index * periodMs);
  const end = new Date(a + (index + 1) * periodMs);
  return { index, start, end };
}

/** Period offset from the current one (0 = current, -1 = previous). */
export function periodByOffset(offset = 0, ref = new Date()) {
  const cur = periodFor(ref);
  const a = anchorMs();
  const periodMs = PERIOD_DAYS * MS_PER_DAY;
  const index = cur.index + offset;
  return {
    index,
    start: new Date(a + index * periodMs),
    end: new Date(a + (index + 1) * periodMs),
  };
}

export function fmtDate(d) {
  return d.toLocaleDateString('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function periodLabel(p) {
  const endInclusive = new Date(p.end.getTime() - MS_PER_DAY);
  return `${fmtDate(p.start)} au ${fmtDate(endInclusive)}`;
}
