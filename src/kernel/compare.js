// compare.js — baseline-vs-current matching and diff. Pure.
//
// Activities are matched by task_code (P6 can renumber task_id across
// re-imports; codes are the stable join key). Added/removed activities are
// reported explicitly, never silently dropped. Critical-path shift is a set
// difference of {total float <= 0} between files — deliberately not a full
// re-derived CPM sequence diff.

import { workingDaysBetween, dayFloor } from './calendar.js';

export function compareModels(current, baseline) {
  const matched = [];
  const added = [];   // in current, not in baseline
  const removed = []; // in baseline, not in current

  for (const t of current.tasks) {
    const b = baseline.taskByCode.get(t.code);
    if (!b) { added.push(t); continue; }
    const curFinish = t.actEnd !== undefined ? t.actEnd : t.targetEnd;
    const baseFinish = b.targetEnd;
    let slipDays;
    if (curFinish !== undefined && baseFinish !== undefined) {
      slipDays = workingDaysBetween(t.cal, Math.min(baseFinish, curFinish), Math.max(baseFinish, curFinish));
      if (dayFloor(curFinish) < dayFloor(baseFinish)) slipDays = -slipDays;
    }
    matched.push({ code: t.code, cur: t, base: b, slipDays, curFinish, baseFinish });
  }
  for (const b of baseline.tasks) {
    if (!current.taskByCode.has(b.code)) removed.push(b);
  }
  matched.sort((a, b2) => (b2.slipDays ?? -Infinity) - (a.slipDays ?? -Infinity));

  // WBS-level variance: cost-weighted mean slip, keyed by the CURRENT file's
  // WBS placement of each matched activity.
  const wbsVar = new Map();
  for (const m of matched) {
    if (m.slipDays === undefined) continue;
    const w = m.cur.targetCost || 0;
    const node = current.wbsById.get(m.cur.wbsId);
    const id = node ? node.id : '__none';
    if (!wbsVar.has(id)) wbsVar.set(id, { node, cost: 0, weighted: 0, count: 0, worst: null });
    const v = wbsVar.get(id);
    v.cost += w; v.weighted += w * m.slipDays; v.count++;
    if (!v.worst || m.slipDays > v.worst.slipDays) v.worst = m;
  }
  const wbsVariance = [...wbsVar.values()].map((v) => ({
    ...v,
    meanSlip: v.cost > 0 ? v.weighted / v.cost : undefined, // uncosted subtree => N/A, not 0
  })).sort((a, b2) => (b2.meanSlip ?? -Infinity) - (a.meanSlip ?? -Infinity));

  // Critical set shift (float <= 0, incomplete, measurable float only)
  const critSet = (m) => new Set(m.tasks
    .filter((t) => t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete')
    .map((t) => t.code));
  const curCrit = critSet(current);
  const baseCrit = critSet(baseline);
  const nowCritical = [...curCrit].filter((c) => !baseCrit.has(c)).map((c) => current.taskByCode.get(c));
  const leftCritical = [...baseCrit].filter((c) => !curCrit.has(c))
    .map((c) => current.taskByCode.get(c) || baseline.taskByCode.get(c));

  return { matched, added, removed, wbsVariance, nowCritical, leftCritical, curCritCount: curCrit.size, baseCritCount: baseCrit.size };
}
