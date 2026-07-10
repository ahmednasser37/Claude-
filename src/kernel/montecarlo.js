// montecarlo.js — real schedule risk simulation. Pure, seeded, reproducible.
//
// Each iteration samples a triangular duration multiplier for every
// INCOMPLETE activity (completed work is history — its duration is fixed),
// rebuilds the duration set, and re-runs the full CPM forward/backward pass
// over the actual relationship network. This is the spec's bar: a fixed-seed
// random multiplier on one aggregate number would look authoritative while
// being disconnected from the schedule logic — so the logic runs every time.
//
// Model caveat (same as DCMA check 12, stated everywhere it surfaces): the
// CPM is the logic-integrity model — working-day units, original durations,
// lags at the project calendar's day length.

import { runCPM } from './cpm.js';
import { addWorkingDays, workingDaysBetween, dayFloor } from './calendar.js';

// mulberry32 — small, fast, deterministic PRNG
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// triangular sample from uniform u over [a, b] with mode m
export function triSample(u, a, m, b) {
  if (b <= a) return a;
  const f = (m - a) / (b - a);
  return u < f
    ? a + Math.sqrt(u * (b - a) * (m - a))
    : b - Math.sqrt((1 - u) * (b - a) * (b - m));
}

export const MC_SPREADS = {
  tight: { label: 'Tight (95 / 100 / 115%)', o: 0.95, m: 1.0, p: 1.15 },
  moderate: { label: 'Moderate (90 / 100 / 130%)', o: 0.90, m: 1.0, p: 1.30 },
  wide: { label: 'Wide (80 / 100 / 150%)', o: 0.80, m: 1.0, p: 1.50 },
};

export function runMonteCarlo(model, { iterations = 1000, spread = MC_SPREADS.moderate, seed = 20260710 } = {}) {
  const det = runCPM(model);
  if (det.cyclic) return { ok: false, reason: 'Relationship network contains a cycle — CPM simulation not possible.' };

  const rand = mulberry32(seed);
  const uncertain = model.tasks.filter((t) =>
    t.status !== 'TK_Complete' && !t.milestone && (t.origDays ?? 0) > 0);
  if (uncertain.length === 0) {
    return { ok: false, reason: 'No incomplete activities with duration — nothing to simulate.' };
  }

  const finishes = new Float64Array(iterations);
  const critCount = new Map(model.tasks.map((t) => [t.id, 0]));
  const samples = new Map(uncertain.map((t) => [t.id, new Float64Array(iterations)]));

  for (let i = 0; i < iterations; i++) {
    const override = new Map();
    for (const t of uncertain) {
      const mult = triSample(rand(), spread.o, spread.m, spread.p);
      samples.get(t.id)[i] = mult;
      override.set(t.id, t.origDays * mult);
    }
    const r = runCPM(model, { durationOverride: override });
    finishes[i] = r.finishDays;
    for (const n of r.order) {
      if (n.d > 0 && n.tf <= 1e-9) critCount.set(n.id, critCount.get(n.id) + 1);
    }
  }

  const sorted = [...finishes].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(Math.floor((p / 100) * iterations), iterations - 1)];

  // working-day counts anchor to the plan start on the project calendar
  let anchor = Infinity;
  for (const t of model.tasks) if (t.targetStart !== undefined) anchor = Math.min(anchor, t.targetStart);
  anchor = dayFloor(anchor);
  const toDate = (days) => addWorkingDays(model.projectCal, anchor, Math.round(days));

  // probability of meeting the deterministic finish and any mandatory finish
  const pAtMost = (days) => sorted.filter((f) => f <= days + 1e-9).length / iterations;
  let constraint = null;
  const mand = model.tasks.find((t) => t.cstrType === 'CS_MANDFIN' && t.cstrDate !== undefined);
  if (mand) {
    const cDays = workingDaysBetween(model.projectCal, anchor, mand.cstrDate);
    constraint = { task: mand, date: mand.cstrDate, days: cDays, pMeet: pAtMost(cDays) };
  }

  // criticality index — fraction of iterations on the critical path
  const criticality = model.tasks
    .map((t) => ({ t, index: critCount.get(t.id) / iterations }))
    .filter((x) => x.index > 0.01 && !x.t.milestone)
    .sort((a, b) => b.index - a.index);

  // duration sensitivity — Pearson correlation of each activity's sampled
  // multiplier against the iteration finish (the tornado)
  const meanF = finishes.reduce((a, v) => a + v, 0) / iterations;
  const sdF = Math.sqrt(finishes.reduce((a, v) => a + (v - meanF) ** 2, 0) / iterations) || 1;
  const sensitivity = uncertain.map((t) => {
    const xs = samples.get(t.id);
    const meanX = xs.reduce((a, v) => a + v, 0) / iterations;
    const sdX = Math.sqrt(xs.reduce((a, v) => a + (v - meanX) ** 2, 0) / iterations) || 1;
    let cov = 0;
    for (let i = 0; i < iterations; i++) cov += (xs[i] - meanX) * (finishes[i] - meanF);
    cov /= iterations;
    return { t, r: cov / (sdX * sdF) };
  }).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  // histogram buckets for the finish distribution
  const lo = sorted[0], hi = sorted[iterations - 1];
  const nBins = Math.min(Math.max(Math.round(Math.sqrt(iterations) / 2), 12), 40);
  const binW = (hi - lo) / nBins || 1;
  const bins = Array.from({ length: nBins }, (_, k) => ({
    fromDays: lo + k * binW, toDays: lo + (k + 1) * binW, count: 0,
  }));
  for (const f of sorted) {
    const k = Math.min(Math.floor((f - lo) / binW), nBins - 1);
    bins[k].count++;
  }

  return {
    ok: true,
    iterations, seed, spread,
    deterministicDays: det.finishDays,
    deterministicDate: toDate(det.finishDays),
    pDeterministic: pAtMost(det.finishDays),
    p10: { days: pct(10), date: toDate(pct(10)) },
    p50: { days: pct(50), date: toDate(pct(50)) },
    p80: { days: pct(80), date: toDate(pct(80)) },
    p90: { days: pct(90), date: toDate(pct(90)) },
    minDays: lo, maxDays: hi,
    bins, sorted, toDate,
    constraint,
    criticality, sensitivity,
    uncertainCount: uncertain.length,
    anchor,
  };
}
