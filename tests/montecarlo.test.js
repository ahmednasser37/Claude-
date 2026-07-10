// Monte Carlo tests — seeded reproducibility, statistical invariants, and
// the identity check: with zero uncertainty the simulation must reproduce
// the deterministic CPM exactly (proof it re-runs the real network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseXER } from '../src/kernel/xer-parser.js';
import { buildModel } from '../src/kernel/model.js';
import { runCPM } from '../src/kernel/cpm.js';
import { runMonteCarlo, triSample, mulberry32 } from '../src/kernel/montecarlo.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const m = buildModel(parseXER(fs.readFileSync(path.join(ROOT, 'tests/fixtures/najd-s2-update.xer'), 'utf8')));

test('triangular sampler stays in bounds and hits the mode region', () => {
  const rand = mulberry32(42);
  let lo = Infinity, hi = -Infinity, sum = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const v = triSample(rand(), 0.8, 1.0, 1.5);
    lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v;
  }
  assert.ok(lo >= 0.8 && hi <= 1.5);
  const mean = sum / N; // triangular mean = (a+m+b)/3 = 1.1
  assert.ok(Math.abs(mean - 1.1) < 0.02);
});

test('MC: same seed reproduces exactly; different seed differs', () => {
  const a = runMonteCarlo(m, { iterations: 300, seed: 7 });
  const b = runMonteCarlo(m, { iterations: 300, seed: 7 });
  const c = runMonteCarlo(m, { iterations: 300, seed: 8 });
  assert.equal(a.p50.days, b.p50.days);
  assert.equal(a.p80.days, b.p80.days);
  assert.notEqual(a.sorted.join(','), c.sorted.join(','));
});

test('MC: zero uncertainty collapses to the deterministic CPM finish', () => {
  const mc = runMonteCarlo(m, { iterations: 50, spread: { o: 1, m: 1, p: 1 }, seed: 1 });
  const det = runCPM(m).finishDays;
  assert.ok(Math.abs(mc.p50.days - det) < 1e-9);
  assert.ok(Math.abs(mc.minDays - mc.maxDays) < 1e-9);
});

test('MC: percentiles ordered, probabilities coherent', () => {
  const mc = runMonteCarlo(m, { iterations: 800, seed: 11 });
  assert.ok(mc.ok);
  assert.ok(mc.p10.days <= mc.p50.days);
  assert.ok(mc.p50.days <= mc.p80.days);
  assert.ok(mc.p80.days <= mc.p90.days);
  assert.ok(mc.pDeterministic >= 0 && mc.pDeterministic <= 1);
  // with the mode at 100% and a right-skewed spread, the deterministic
  // finish sits low in the distribution
  assert.ok(mc.pDeterministic < 0.5);
  // completed work never varies: only incomplete non-milestones are sampled
  assert.equal(mc.uncertainCount, m.tasks.filter((t) => t.status !== 'TK_Complete' && !t.milestone && (t.origDays ?? 0) > 0).length);
});

test('MC: criticality and sensitivity point at the driving chain', () => {
  const mc = runMonteCarlo(m, { iterations: 800, seed: 11 });
  const critCodes = mc.criticality.slice(0, 8).map((c) => c.t.code);
  // the deterministic longest path runs through S34 welding — it must show up
  assert.ok(critCodes.some((c) => c.startsWith('S34')));
  const top = mc.criticality[0];
  assert.ok(top.index > 0.5);
  // sensitivity correlations are valid r values, strongest first
  for (const s of mc.sensitivity) assert.ok(s.r >= -1.001 && s.r <= 1.001);
  assert.ok(Math.abs(mc.sensitivity[0].r) >= Math.abs(mc.sensitivity[Math.min(5, mc.sensitivity.length - 1)].r));
  assert.ok(Math.abs(mc.sensitivity[0].r) > 0.3);
  // mandatory finish constraint is evaluated
  assert.ok(mc.constraint);
  assert.equal(mc.constraint.task.code, 'M-100');
  assert.ok(mc.constraint.pMeet >= 0 && mc.constraint.pMeet <= 1);
});

test('MC: histogram bins cover every iteration', () => {
  const mc = runMonteCarlo(m, { iterations: 600, seed: 3 });
  assert.equal(mc.bins.reduce((a, b) => a + b.count, 0), 600);
});
