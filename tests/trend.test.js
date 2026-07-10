// trend.js tests — multi-update trending across the generated history
// (Mar 2026 -> May 2026 -> Jul 2026). Assertions are the invariants the
// engineered degradation story must satisfy, plus honesty guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseXER } from '../src/kernel/xer-parser.js';
import { buildModel } from '../src/kernel/model.js';
import { buildTrend } from '../src/kernel/trend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => buildModel(parseXER(fs.readFileSync(path.join(ROOT, 'tests/fixtures', f), 'utf8')));

const upd1 = load('najd-s2-upd-2026-03.xer');
const upd2 = load('najd-s2-upd-2026-05.xer');
const current = load('najd-s2-update.xer');
const trend = buildTrend([
  { model: upd2, name: 'upd2' },   // deliberately out of order — must sort
  { model: current, name: 'current' },
  { model: upd1, name: 'upd1' },
]);

test('trend: refuses to trend fewer than 2 distinct data dates', () => {
  const t1 = buildTrend([{ model: current, name: 'only' }]);
  assert.equal(t1.ok, false);
  assert.ok(t1.reason.includes('2 updates'));
  // same file twice = one distinct data date
  const t2 = buildTrend([{ model: current, name: 'a' }, { model: current, name: 'b' }]);
  assert.equal(t2.ok, false);
});

test('trend: points sorted by data date, one point per snapshot', () => {
  assert.equal(trend.ok, true);
  assert.equal(trend.points.length, 3);
  for (let i = 1; i < 3; i++) assert.ok(trend.points[i].dd > trend.points[i - 1].dd);
  assert.deepEqual(trend.points.map((p) => p.name), ['upd1', 'upd2', 'current']);
});

test('trend: the degradation story is monotonic where it must be', () => {
  const [a, b, c] = trend.points;
  // work only accumulates
  assert.ok(a.ev < b.ev && b.ev < c.ev);
  assert.ok(a.ac < b.ac && b.ac < c.ac);
  assert.ok(a.done <= b.done && b.done <= c.done); // completions can stall...
  assert.ok(a.done < c.done);                      // ...but not forever
  // the forecast finish never improves in this story, and slips overall
  assert.ok(a.finish <= b.finish && b.finish <= c.finish);
  assert.ok(a.finish < c.finish);
  // negative float spreads
  assert.ok(a.negFloat <= b.negFloat && b.negFloat <= c.negFloat);
  assert.ok(c.negFloat > a.negFloat);
});

test('trend: windows attribute slip and criticality growth', () => {
  assert.equal(trend.windows.length, 2);
  for (const w of trend.windows) {
    assert.ok(w.evAccrued > 0);
    assert.ok(w.acAccrued > 0);
    assert.ok(w.finishSlipWd >= 0);
  }
  const allNew = trend.windows.flatMap((w) => w.newlyCritical.map((t) => t.code));
  assert.ok(allNew.length > 0);
  // Segment D joins the critical set somewhere in the history
  assert.ok(allNew.some((code) => code.startsWith('S34')));
  // everything flagged newly-critical is genuinely critical in that window's end snapshot
  for (const w of trend.windows) {
    for (const task of w.newlyCritical) assert.ok(w.to.crit.has(task.code));
  }
});

test('trend: float erosion ranks the welding squeeze first, no gap-filling', () => {
  assert.ok(trend.floatErosion.length > 0);
  const worst = trend.floatErosion[0];
  assert.ok(worst.delta < 0);
  assert.ok(worst.code.startsWith('S34') || worst.code.startsWith('S33'));
  // vals may contain undefined (activity complete / float absent in an
  // update) — never a substituted number
  for (const f of trend.floatErosion) {
    assert.equal(f.vals.length, 3);
    const known = f.vals.filter((v) => v !== undefined);
    assert.ok(known.length >= 2);
  }
});
