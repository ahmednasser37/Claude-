// trend.js — multi-update trending. Pure.
//
// This is the one place a real history is legitimate: each point comes from
// its own XER snapshot's recorded state at its own data date. Nothing is
// interpolated between updates and nothing is extrapolated — N updates give
// exactly N points.

import { computeEVM } from './evm.js';
import { runAllChecks } from './dcma.js';
import { workingDaysBetween } from './calendar.js';

function planFinish(model) {
  let t1;
  for (const t of model.tasks) {
    if (t.targetEnd !== undefined && (t1 === undefined || t.targetEnd > t1)) t1 = t.targetEnd;
  }
  return t1;
}

function critCodes(model) {
  return new Set(model.tasks
    .filter((t) => t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete')
    .map((t) => t.code));
}

// buildTrend(updates) — updates: [{model, name}], any order; deduped by data
// date, sorted ascending. Returns {points, windows, floatErosion} or a
// reasoned refusal when fewer than 2 distinct data dates exist.
export function buildTrend(updates) {
  const byDD = new Map();
  for (const u of updates) {
    if (!u.model || u.model.dataDate === undefined) continue;
    byDD.set(u.model.dataDate, u); // same data date twice = same update re-loaded
  }
  const sorted = [...byDD.values()].sort((a, b) => a.model.dataDate - b.model.dataDate);
  if (sorted.length < 2) {
    return { ok: false, reason: `Trending needs at least 2 updates with distinct data dates — ${sorted.length} loaded.`, points: [] };
  }

  const points = sorted.map(({ model, name }) => {
    const evm = computeEVM(model);
    const checks = runAllChecks(model, {});
    const done = model.tasks.filter((t) => t.status === 'TK_Complete').length;
    return {
      name, model,
      dd: model.dataDate,
      finish: planFinish(model),
      ev: evm.ev, ac: evm.ac, pvAtDD: evm.pvAtDD, bac: evm.bac,
      spi: evm.spi.value, cpi: evm.cpi.value, spit: evm.es.value,
      eac: evm.eac,
      negFloat: model.tasks.filter((t) => t.totalFloatHrs !== undefined && t.totalFloatHrs < 0 && t.status !== 'TK_Complete').length,
      crit: critCodes(model),
      done, total: model.tasks.length,
      dcmaPass: checks.filter((c) => c.status === 'pass').length,
      dcmaComputable: checks.filter((c) => c.status !== 'na').length,
    };
  });

  const cal = points[points.length - 1].model.projectCal;

  // windows: what happened between consecutive updates — the attribution view
  const windows = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const newlyCritical = [...b.crit].filter((c) => !a.crit.has(c))
      .map((c) => b.model.taskByCode.get(c)).filter(Boolean);
    const recovered = [...a.crit].filter((c) => !b.crit.has(c))
      .map((c) => b.model.taskByCode.get(c) || a.model.taskByCode.get(c)).filter(Boolean);
    windows.push({
      from: a, to: b,
      periodWd: workingDaysBetween(cal, a.dd, b.dd),
      finishSlipWd: (a.finish !== undefined && b.finish !== undefined)
        ? workingDaysBetween(cal, Math.min(a.finish, b.finish), Math.max(a.finish, b.finish)) * (b.finish >= a.finish ? 1 : -1)
        : undefined,
      evAccrued: b.ev - a.ev,   // real: difference of two recorded snapshots
      acAccrued: b.ac - a.ac,
      completedInWindow: b.done - a.done,
      newlyCritical, recovered,
    });
  }

  // float erosion: per activity code, the float series across updates
  // (only where the update actually carries a float — no gap-filling)
  const floatSeries = new Map();
  for (const p of points) {
    for (const t of p.model.tasks) {
      if (t.floatDays === undefined || t.status === 'TK_Complete') continue;
      if (!floatSeries.has(t.code)) floatSeries.set(t.code, { code: t.code, name: t.name, series: new Map() });
      floatSeries.get(t.code).series.set(p.dd, t.floatDays);
    }
  }
  const floatErosion = [...floatSeries.values()]
    .map((f) => {
      const vals = points.map((p) => f.series.get(p.dd)); // undefined where absent
      const known = vals.filter((v) => v !== undefined);
      return { ...f, vals, delta: known.length >= 2 ? +(known[known.length - 1] - known[0]).toFixed(1) : undefined };
    })
    .filter((f) => f.delta !== undefined)
    .sort((a, b) => a.delta - b.delta); // most-eroded first

  return { ok: true, points, windows, floatErosion };
}
