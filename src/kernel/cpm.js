// cpm.js — a real forward/backward critical-path pass over the TASKPRED
// network, in working-day units. Pure.
//
// Stated simplifications (documented, not hidden):
//  - Durations are each task's original working-day span (from its own
//    calendar); lags convert at the project calendar's hours-per-day.
//  - The pass runs on logic alone from a common time zero — it is a logic
//    integrity model (exactly what DCMA check 12 exercises), not a
//    progress-retained reschedule. File float (total_float_hr_cnt) remains
//    the source of truth for float-based checks.

export function runCPM(model, { durationOverride = null } = {}) {
  const dayHrs = model.projectCal.dayHrs || 8;
  const nodes = new Map(); // id -> {d, es, ef, ls, lf, succs:[], preds:[], inDeg}
  for (const t of model.tasks) {
    let d = t.milestone ? 0 : (t.origDays !== undefined ? t.origDays : 0);
    if (durationOverride && durationOverride.has(t.id)) d = durationOverride.get(t.id);
    nodes.set(t.id, { id: t.id, d, es: 0, ef: d, ls: Infinity, lf: Infinity, succs: [], preds: [], inDeg: 0 });
  }
  for (const p of model.preds) {
    const a = nodes.get(p.predTaskId), b = nodes.get(p.taskId);
    if (!a || !b) continue;
    const lag = (p.lagHrs || 0) / dayHrs;
    a.succs.push({ to: b, type: p.type, lag });
    b.preds.push({ from: a, type: p.type, lag });
    b.inDeg++;
  }

  // Kahn topological order; if a cycle exists, report it instead of looping.
  const order = [];
  const q = [];
  for (const n of nodes.values()) if (n.inDeg === 0) q.push(n);
  const deg = new Map();
  for (const n of nodes.values()) deg.set(n, n.inDeg);
  while (q.length) {
    const n = q.shift();
    order.push(n);
    for (const e of n.succs) {
      deg.set(e.to, deg.get(e.to) - 1);
      if (deg.get(e.to) === 0) q.push(e.to);
    }
  }
  const cyclic = order.length < nodes.size;
  if (cyclic) return { cyclic: true, nodes, order: [], finishDays: undefined };

  // Forward pass.
  for (const n of order) {
    for (const e of n.preds) {
      const { from, type, lag } = e;
      let minEs;
      switch (type) {
        case 'PR_SS': minEs = from.es + lag; break;
        case 'PR_FF': minEs = from.ef + lag - n.d; break;
        case 'PR_SF': minEs = from.es + lag - n.d; break;
        default:      minEs = from.ef + lag; // PR_FS
      }
      if (minEs > n.es) n.es = minEs;
    }
    n.ef = n.es + n.d;
  }
  let finishDays = 0;
  for (const n of order) if (n.ef > finishDays) finishDays = n.ef;

  // Backward pass.
  for (const n of order) { n.lf = finishDays; n.ls = finishDays - n.d; }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    for (const e of n.succs) {
      const s = e.to;
      let maxLf;
      switch (e.type) {
        case 'PR_SS': maxLf = s.ls - e.lag + n.d; break;
        case 'PR_FF': maxLf = s.lf - e.lag; break;
        case 'PR_SF': maxLf = s.lf - e.lag + n.d; break; // pred start drives succ finish
        default:      maxLf = s.ls - e.lag; // PR_FS
      }
      if (maxLf < n.lf) n.lf = maxLf;
    }
    n.ls = n.lf - n.d;
  }
  for (const n of order) n.tf = n.ls - n.es;

  return { cyclic: false, nodes, order, finishDays };
}

// DCMA check 12 — Critical Path Test: extend a driving activity's duration
// and confirm the project finish shifts by the same amount.
export function criticalPathTest(model, extendBy = 100) {
  const base = runCPM(model);
  if (base.cyclic) return { status: 'na', reason: 'Relationship network contains a cycle — CPM pass not possible.' };
  // pick a driving activity: critical (tf ≈ 0 or less), real duration, on the finish path
  let pick = null;
  for (const n of base.order) {
    if (n.d > 0 && n.tf <= 1e-9 && (!pick || n.d > pick.d)) pick = n;
  }
  if (!pick) return { status: 'na', reason: 'No critical activity with duration > 0 found to perturb.' };
  const perturbed = runCPM(model, { durationOverride: new Map([[pick.id, pick.d + extendBy]]) });
  if (perturbed.cyclic) return { status: 'na', reason: 'Network became cyclic during perturbation (should not happen).' };
  const shift = perturbed.finishDays - base.finishDays;
  const pass = Math.abs(shift - extendBy) < 1e-6;
  const task = model.taskById.get(pick.id);
  return {
    status: pass ? 'pass' : 'fail',
    tested: task ? task.code : pick.id,
    extendBy, shift,
    baseFinishDays: base.finishDays,
    reason: pass
      ? `Extended ${task ? task.code : pick.id} by ${extendBy} working days; project finish moved exactly ${shift} days.`
      : `Extended ${task ? task.code : pick.id} by ${extendBy} working days but project finish moved ${shift} days — constraints or broken logic are absorbing the slip.`,
  };
}
