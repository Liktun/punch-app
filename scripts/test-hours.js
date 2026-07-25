// Minimal sanity tests for the hours math. Run: node scripts/test-hours.js
// Breaks are punched explicitly by the employee (no automatic deduction).
// OT: >40h/week.
import assert from 'node:assert';
import { aggregate, shiftNet, breaksTotal, fmtHours } from '../src/hours.js';

function iso(y, mo, d, h, mi) { return new Date(y, mo - 1, d, h, mi).toISOString(); }
function brk(y, mo, d, h1, m1, h2, m2) {
  return { break_in: iso(y, mo, d, h1, m1), break_out: h2 === null ? null : iso(y, mo, d, h2, m2) };
}

// 1) Shift with no punched break: nothing is deducted (even a long one).
let s = shiftNet({ clock_in: iso(2026, 1, 5, 9, 0), clock_out: iso(2026, 1, 5, 18, 0), breaks: [] });
assert.strictEqual(s.breakMs, 0, 'no break punched -> no deduction');
assert.strictEqual(s.netMs, 9 * 3600000, '9h net when no break punched');

// 2) One punched break of 30 min is deducted.
s = shiftNet({
  clock_in: iso(2026, 1, 5, 9, 0), clock_out: iso(2026, 1, 5, 17, 0),
  breaks: [brk(2026, 1, 5, 12, 0, 12, 30)],
});
assert.strictEqual(s.breakMs, 30 * 60000, '30min punched break');
assert.strictEqual(s.netMs, (8 * 3600000) - (30 * 60000), '7h30 net');

// 3) Multiple breaks add up (15 + 45 = 1h).
s = shiftNet({
  clock_in: iso(2026, 1, 5, 8, 0), clock_out: iso(2026, 1, 5, 17, 0),
  breaks: [brk(2026, 1, 5, 10, 0, 10, 15), brk(2026, 1, 5, 12, 0, 12, 45)],
});
assert.strictEqual(s.breakMs, 60 * 60000, 'two breaks total 1h');
assert.strictEqual(s.netMs, 8 * 3600000, '9h - 1h = 8h net');

// 4) A break still in progress is not counted until closed.
s = shiftNet({
  clock_in: iso(2026, 1, 5, 9, 0), clock_out: iso(2026, 1, 5, 17, 0),
  breaks: [brk(2026, 1, 5, 12, 0, null, null)],
});
assert.strictEqual(s.breakMs, 0, 'open break not counted');
assert.strictEqual(s.netMs, 8 * 3600000, 'net unaffected by open break');

// 5) Breaks are clamped to the shift window (bad admin correction can't go negative).
const total = breaksTotal(
  [brk(2026, 1, 5, 7, 0, 23, 0)],                       // way outside
  new Date(iso(2026, 1, 5, 9, 0)).getTime(),
  new Date(iso(2026, 1, 5, 17, 0)).getTime()
);
assert.strictEqual(total, 8 * 3600000, 'break clamped to the shift');
s = shiftNet({
  clock_in: iso(2026, 1, 5, 9, 0), clock_out: iso(2026, 1, 5, 17, 0),
  breaks: [brk(2026, 1, 5, 7, 0, 23, 0)],
});
assert.strictEqual(s.netMs, 0, 'net floored at 0, never negative');

// 6) Open shift: 0 net, flagged open.
s = shiftNet({ clock_in: iso(2026, 1, 5, 9, 0), clock_out: null });
assert.ok(s.open && s.netMs === 0, 'open shift');

// 7) Weekly overtime: Mon-Fri 9h shifts each with a punched 30min break
//    => 8h30 net x5 = 42h30. OT = 2h30 over 40h.
const week = [];
for (let d = 5; d <= 9; d++) { // Jan 5-9 2026 = Mon-Fri
  week.push({
    clock_in: iso(2026, 1, d, 8, 0), clock_out: iso(2026, 1, d, 17, 0),
    breaks: [brk(2026, 1, d, 12, 0, 12, 30)],
  });
}
const agg = aggregate(week);
assert.strictEqual(fmtHours(agg.netMs), '42h30', `net ${fmtHours(agg.netMs)}`);
assert.strictEqual(fmtHours(agg.breakMs), '2h30', `breaks ${fmtHours(agg.breakMs)}`);
assert.strictEqual(fmtHours(agg.overtimeMs), '2h30', `OT ${fmtHours(agg.overtimeMs)}`);
assert.strictEqual(fmtHours(agg.regularMs), '40h00', `reg ${fmtHours(agg.regularMs)}`);

// 8) Two separate weeks each at 42h30 net -> OT = 2 x 2h30 = 5h.
const twoWeeks = [];
for (const d of [5, 6, 7, 8, 9, 12, 13, 14, 15, 16]) {
  twoWeeks.push({
    clock_in: iso(2026, 1, d, 8, 0), clock_out: iso(2026, 1, d, 17, 0),
    breaks: [brk(2026, 1, d, 12, 0, 12, 30)],
  });
}
const agg2 = aggregate(twoWeeks);
assert.strictEqual(fmtHours(agg2.overtimeMs), '5h00', `2wk OT ${fmtHours(agg2.overtimeMs)}`);

console.log('All hours.js tests passed ✅');
