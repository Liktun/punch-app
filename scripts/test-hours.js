// Minimal sanity tests for the hours math. Run: node scripts/test-hours.js
// Uses default env (break: >6h -> -30min, OT: >40h/week).
import assert from 'node:assert';
import { aggregate, shiftNet, fmtHours } from '../src/hours.js';

function iso(y, mo, d, h, mi) { return new Date(y, mo - 1, d, h, mi).toISOString(); }

// 1) Short shift: no break deducted (5h).
let s = shiftNet({ clock_in: iso(2026, 1, 5, 9, 0), clock_out: iso(2026, 1, 5, 14, 0) });
assert.strictEqual(s.breakMs, 0, 'no break under threshold');
assert.strictEqual(s.netMs, 5 * 3600000, '5h net');

// 2) Long shift: 8h -> -30min break -> 7h30 net.
s = shiftNet({ clock_in: iso(2026, 1, 5, 9, 0), clock_out: iso(2026, 1, 5, 17, 0) });
assert.strictEqual(s.breakMs, 30 * 60000, '30min break');
assert.strictEqual(s.netMs, (8 * 3600000) - (30 * 60000), '7h30 net');

// 3) Open shift: 0 net, flagged open.
s = shiftNet({ clock_in: iso(2026, 1, 5, 9, 0), clock_out: null });
assert.ok(s.open && s.netMs === 0, 'open shift');

// 4) Weekly overtime: one week with 5 x 9h shifts (Mon-Fri) = 45h gross,
//    each -30min break => 8h30 net x5 = 42h30 net. OT = 2h30 over 40h.
const week = [];
for (let d = 5; d <= 9; d++) { // Jan 5-9 2026 = Mon-Fri
  week.push({ clock_in: iso(2026, 1, d, 8, 0), clock_out: iso(2026, 1, d, 17, 0) }); // 9h
}
const agg = aggregate(week);
assert.strictEqual(fmtHours(agg.netMs), '42h30', `net ${fmtHours(agg.netMs)}`);
assert.strictEqual(fmtHours(agg.overtimeMs), '2h30', `OT ${fmtHours(agg.overtimeMs)}`);
assert.strictEqual(fmtHours(agg.regularMs), '40h00', `reg ${fmtHours(agg.regularMs)}`);

// 5) Two separate weeks each at 42h30 net -> OT should be 2x2h30 = 5h (not summed across weeks incorrectly).
const twoWeeks = [];
for (let d = 5; d <= 9; d++) twoWeeks.push({ clock_in: iso(2026, 1, d, 8, 0), clock_out: iso(2026, 1, d, 17, 0) });
for (let d = 12; d <= 16; d++) twoWeeks.push({ clock_in: iso(2026, 1, d, 8, 0), clock_out: iso(2026, 1, d, 17, 0) });
const agg2 = aggregate(twoWeeks);
assert.strictEqual(fmtHours(agg2.overtimeMs), '5h00', `2wk OT ${fmtHours(agg2.overtimeMs)}`);

console.log('All hours.js tests passed ✅');
