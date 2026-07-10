// resource.js — demand buckets + over-allocation. Pure.
//
// Over-allocation is only computable for resources that carry a
// RSRCRATE.max_qty_per_hr ceiling. For everything else the honest answer is
// "ceiling unavailable" — never an assumed default (a prior build defaulted
// missing ceilings to 1 and flagged nearly everything).

import { spreadAcrossPeriods, periodStart, hoursOnDay, dayFloor, DAY_MS } from './calendar.js';

export function resourceDemand(model, gran = 'week') {
  const byType = new Map();   // rsrc_type -> Map(periodKey -> qty)
  const byRsrc = new Map();   // rsrc_id  -> Map(periodKey -> qty)
  const allKeys = new Set();

  for (const a of model.assignments) {
    const task = model.taskById.get(a.taskId);
    const rsrc = model.rsrcById.get(a.rsrcId);
    if (!task || !rsrc) continue;
    const qty = a.targetQty;
    if (qty === undefined || task.targetStart === undefined || task.targetEnd === undefined) continue;
    if (!byType.has(rsrc.type)) byType.set(rsrc.type, new Map());
    if (!byRsrc.has(rsrc.id)) byRsrc.set(rsrc.id, new Map());
    spreadAcrossPeriods(task.cal, task.targetStart, task.targetEnd, qty, gran, byType.get(rsrc.type));
    spreadAcrossPeriods(task.cal, task.targetStart, task.targetEnd, qty, gran, byRsrc.get(rsrc.id));
  }
  for (const m of byType.values()) for (const k of m.keys()) allKeys.add(k);
  const keys = [...allKeys].sort();

  // Over-allocation: average demanded qty/hr in a period vs max_qty_per_hr.
  const overalloc = [];
  const noCeiling = [];
  for (const [rid, periods] of byRsrc) {
    const rsrc = model.rsrcById.get(rid);
    if (rsrc.maxQtyPerHr === undefined) {
      if ([...periods.values()].some((v) => v > 0)) noCeiling.push(rsrc);
      continue;
    }
    for (const [key, qty] of periods) {
      const hrs = periodWorkingHours(model.projectCal, key, gran);
      if (hrs <= 0) continue;
      const avgPerHr = qty / hrs;
      // 5% tolerance: calendar exceptions (half-days) compress a task's hour
      // density slightly; only clear breaches are worth a planner's time.
      if (avgPerHr > rsrc.maxQtyPerHr * 1.05) {
        overalloc.push({
          rsrc, key, start: periodStart(key, gran), qty,
          avgPerHr, maxPerHr: rsrc.maxQtyPerHr,
          ratio: avgPerHr / rsrc.maxQtyPerHr,
        });
      }
    }
  }
  overalloc.sort((a, b) => b.ratio - a.ratio);

  return { gran, keys, byType, byRsrc, overalloc, noCeiling };
}

function periodWorkingHours(cal, key, gran) {
  const start = periodStart(key, gran);
  const days = gran === 'week' ? 7 : new Date(Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + 1, 0)).getUTCDate();
  let hrs = 0;
  for (let i = 0; i < days; i++) hrs += hoursOnDay(cal, dayFloor(start) + i * DAY_MS);
  return hrs;
}
