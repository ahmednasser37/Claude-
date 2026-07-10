// wbs.js — cost-weighted WBS rollup. Pure.
//
// pctComplete(node) = Σ(cost × earnedPct) / Σ(cost) over the node's whole
// subtree, all evaluated at ONE real "as of" date (the model's data date) —
// never "latest end date in the dataset", which equals project finish and
// makes every started activity look ~100% done.

import { computeEarnedPct } from './evm.js';

export function rollupWBS(model) {
  const asOf = model.dataDate;
  const stats = new Map(); // wbsId -> stat

  const visit = (node) => {
    const s = {
      id: node.id, name: node.name, shortName: node.shortName,
      cost: 0, earned: 0, actual: 0,
      taskCount: 0, done: 0, active: 0, notStarted: 0, critical: 0,
      pct: undefined, children: [],
    };
    for (const task of node.tasks) {
      s.taskCount++;
      s.cost += task.targetCost || 0;
      s.earned += (task.targetCost || 0) * computeEarnedPct(task, asOf);
      s.actual += task.actualCost || 0;
      if (task.status === 'TK_Complete') s.done++;
      else if (task.status === 'TK_Active') s.active++;
      else s.notStarted++;
      if (task.totalFloatHrs !== undefined && task.totalFloatHrs <= 0 && task.status !== 'TK_Complete') s.critical++;
    }
    for (const child of node.children) {
      const cs = visit(child);
      s.children.push(cs.id);
      s.cost += cs.cost; s.earned += cs.earned; s.actual += cs.actual;
      s.taskCount += cs.taskCount; s.done += cs.done; s.active += cs.active;
      s.notStarted += cs.notStarted; s.critical += cs.critical;
    }
    // cost-weighted % — undefined (not 0) when the subtree carries no cost
    s.pct = s.cost > 0 ? s.earned / s.cost : undefined;
    stats.set(node.id, s);
    return s;
  };

  const root = visit(model.wbsRoot);
  return { root, stats };
}
