// period.js tests — reporting windows, lookahead, update integrity.
// Expectations are hand-derived from the fixture's engineered facts, or
// asserted against definitional invariants that must hold for any file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseXER } from '../src/kernel/xer-parser.js';
import { buildModel } from '../src/kernel/model.js';
import { dayFloor, DAY_MS } from '../src/kernel/calendar.js';
import { windowReport, buildLookahead, updateIntegrity, floatBands, plannedCostInWindow } from '../src/kernel/period.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = buildModel(parseXER(fs.readFileSync(path.join(ROOT, 'tests/fixtures/najd-s2-update.xer'), 'utf8')));
const dd = dayFloor(m.dataDate);
const U = (y, mo, d) => Date.UTC(y, mo - 1, d);

test('windowReport: full-plan window recovers exactly the recorded history', () => {
  const [from, to] = [U(2025, 1, 1), U(2028, 1, 1)];
  const r = windowReport(m, from, to);
  const complete = m.tasks.filter((t) => t.status === 'TK_Complete');
  const withActStart = m.tasks.filter((t) => t.actStart !== undefined);
  assert.equal(r.completed.length, complete.length);        // 24 completions, from act_end only
  assert.equal(r.started.length, withActStart.length);      // completions + 4 actives
  // value of completions = sum of their budgets, no invented partials
  const expectedValue = complete.reduce((a, t) => a + (t.targetCost || 0), 0);
  assert.ok(Math.abs(r.valueDone - expectedValue) < 1e-6);
  // full-plan planned value = BAC (spread fractions sum to 1 per activity)
  const bac = m.tasks.reduce((a, t) => a + (t.targetCost || 0), 0);
  assert.ok(Math.abs(r.valuePlanned - bac) < 1e-6);
  assert.equal(r.milestonesHit.length, 1);                  // A-000 Notice to Proceed
  assert.equal(r.milestonesHit[0].code, 'A-000');
});

test('windowReport: missed = planned in elapsed window and not done — the stale-forecast set', () => {
  // window = everything up to the data date: missed starts must equal the
  // engineered un-statused set (same 6 as DCMA check 9)
  const r = windowReport(m, U(2025, 9, 1), dd);
  const missedStartCodes = r.missedStart.map((x) => x.t.code).sort();
  assert.deepEqual(missedStartCodes, ['P-040', 'S33-060', 'S33-070', 'S34-030', 'S34-040', 'S34-050']);
  // every missed finish is genuinely incomplete with target_end <= data date
  for (const { t, slipWd } of r.missedFinish) {
    assert.notEqual(t.status, 'TK_Complete');
    assert.ok(dayFloor(t.targetEnd) <= dd);
    assert.ok(slipWd >= 0);
  }
  // S33-060 planned to finish well before DD and never started -> missed
  assert.ok(r.missedFinish.some((x) => x.t.code === 'S33-060'));
});

test('windowReport: future work is never called late', () => {
  // a purely forward window: nothing can be "missed" yet
  const r = windowReport(m, dd + DAY_MS, dd + 60 * DAY_MS);
  assert.equal(r.missedFinish.length, 0);
  assert.equal(r.missedStart.length, 0);
  assert.equal(r.completed.length, 0); // no actual finishes after the data date
});

test('plannedCostInWindow: fractions are proportional and total to the budget', () => {
  const t = m.taskByCode.get('S34-050'); // 46 wd, cost 1.8M
  const whole = plannedCostInWindow(t, U(2025, 1, 1), U(2028, 1, 1));
  assert.ok(Math.abs(whole - t.targetCost) < 1e-6);
  const half1 = plannedCostInWindow(t, U(2025, 1, 1), t.targetStart + 30 * DAY_MS);
  const half2 = plannedCostInWindow(t, t.targetStart + 31 * DAY_MS, U(2028, 1, 1));
  assert.ok(Math.abs(half1 + half2 - t.targetCost) < 1e-6);
  assert.ok(half1 > 0 && half2 > 0);
});

test('lookahead: blocked starts have genuinely unfinished predecessors', () => {
  const la = buildLookahead(m, dd + DAY_MS, dd + 42 * DAY_MS);
  for (const t of la.starting) {
    assert.equal(t.status, 'TK_NotStart');
    assert.ok(dayFloor(t.targetStart) > dd);
  }
  for (const b of la.blockedStarts) {
    for (const { pred, rel } of b.blockers) {
      if (rel.type === 'PR_FS' || rel.type === 'PR_FF') assert.notEqual(pred.status, 'TK_Complete');
      else assert.equal(pred.status, 'TK_NotStart');
    }
  }
});

test('update integrity: the engineered OOS-progress case and clean recordings', () => {
  const f = updateIntegrity(m);
  const by = (id) => f.find((x) => x.id === id);
  // C-010 started before S33-030 actually finished (FS with a -5d lead):
  const oos = by('oos-progress');
  assert.ok(oos.tasks.some((t) => t.code === 'C-010'));
  // the fixture's actuals are otherwise recorded cleanly
  assert.equal(by('future-actuals').tasks.length, 0);
  assert.equal(by('complete-no-finish').tasks.length, 0);
  assert.equal(by('active-no-start').tasks.length, 0);
  assert.equal(by('complete-remaining').tasks.length, 0);
  // un-statused = the DCMA-9 stale forecasts (6 of them)
  assert.equal(by('unstatused').tasks.length, 6);
});

test('float bands: partition is exact — no double counting, no invention', () => {
  const { bands, unmeasured } = floatBands(m);
  const binned = bands.reduce((a, b) => a + b.tasks.length, 0);
  const incomplete = m.tasks.filter((t) => t.status !== 'TK_Complete').length;
  assert.equal(binned + unmeasured, incomplete);
  const neg = bands.find((b) => b.id === 'neg');
  assert.equal(neg.tasks.length, 10); // the engineered negative-float chain
});
