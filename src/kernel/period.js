// period.js — the reporting-window engine: look-back (what happened in a
// window), look-ahead (what's coming), and update-integrity QA. Pure.
//
// Honesty note: a single XER carries one snapshot, but ACTUAL dates are real
// history — "completed in window" and "value of completions" are derived
// from act_start/act_end, never synthesized. What is NOT derivable (per-
// period earned-value history) is not produced here.

import { dayFloor, DAY_MS, hoursOnDay, workingDaysBetween } from './calendar.js';

const inWin = (ms, from, to) => ms !== undefined && dayFloor(ms) >= dayFloor(from) && dayFloor(ms) <= dayFloor(to);

// Fraction of an activity's planned cost that falls inside [from, to],
// proportional to its calendar working hours (same rule as the PV spread).
export function plannedCostInWindow(task, from, to) {
  const cost = task.targetCost || 0;
  if (cost <= 0 || task.targetStart === undefined || task.targetEnd === undefined) return 0;
  const a = dayFloor(task.targetStart), b = dayFloor(task.targetEnd);
  if (b < dayFloor(from) || a > dayFloor(to)) return 0;
  let total = 0, inside = 0;
  for (let d = a; d <= b; d += DAY_MS) {
    const h = hoursOnDay(task.cal, d);
    total += h;
    if (d >= dayFloor(from) && d <= dayFloor(to)) inside += h;
  }
  if (total === 0) return inWin(a, from, to) ? cost : 0;
  return cost * (inside / total);
}

// Look-back report for [from, to].
export function windowReport(model, from, to) {
  const dd = model.dataDate;
  const r = {
    from, to,
    completed: [],      // act_end in window
    started: [],        // act_start in window
    inFlight: [],       // active, overlapping the window, not finished in it
    missedFinish: [],   // planned to finish in window, still not complete
    missedStart: [],    // planned to start in window, still not started
    milestonesHit: [],
    milestonesMissed: [],
    valueDone: 0,       // Σ cost of activities completed in window (real actual dates)
    valuePlanned: 0,    // Σ planned cost falling in window (calendar-spread)
  };
  for (const t of model.tasks) {
    r.valuePlanned += plannedCostInWindow(t, from, to);
    const done = t.status === 'TK_Complete';
    if (t.milestone) {
      if (done && inWin(t.actEnd ?? t.actStart, from, to)) r.milestonesHit.push(t);
      else if (!done && inWin(t.targetEnd, from, to) && (dd === undefined || dayFloor(t.targetEnd) <= dayFloor(Math.min(to, dd)))) r.milestonesMissed.push(t);
      // future milestones inside a forward window are neither hit nor missed
    }
    if (done && inWin(t.actEnd, from, to)) {
      r.completed.push(t);
      r.valueDone += t.targetCost || 0;
    }
    if (inWin(t.actStart, from, to)) r.started.push(t);
    if (t.status === 'TK_Active' && t.actStart !== undefined
      && dayFloor(t.actStart) <= dayFloor(to)) r.inFlight.push(t);
    // "missed" is only meaningful for the part of the window that has already
    // happened — never call future work late.
    const pastEdge = dd !== undefined ? Math.min(dayFloor(to), dayFloor(dd)) : dayFloor(to);
    if (!done && !t.milestone && t.targetEnd !== undefined
      && dayFloor(t.targetEnd) >= dayFloor(from) && dayFloor(t.targetEnd) <= pastEdge) {
      const slipWd = dd !== undefined ? workingDaysBetween(t.cal, t.targetEnd, dd) : undefined;
      r.missedFinish.push({ t, slipWd });
    }
    if (t.status === 'TK_NotStart' && t.targetStart !== undefined
      && dayFloor(t.targetStart) >= dayFloor(from) && dayFloor(t.targetStart) <= pastEdge) {
      const slipWd = dd !== undefined ? workingDaysBetween(t.cal, t.targetStart, dd) : undefined;
      r.missedStart.push({ t, slipWd });
    }
  }
  const byEnd = (a, b) => (a.actEnd ?? 0) - (b.actEnd ?? 0);
  r.completed.sort(byEnd);
  r.started.sort((a, b) => (a.actStart ?? 0) - (b.actStart ?? 0));
  r.missedFinish.sort((a, b) => (b.slipWd ?? 0) - (a.slipWd ?? 0));
  r.missedStart.sort((a, b) => (b.slipWd ?? 0) - (a.slipWd ?? 0));
  return r;
}

// Look-ahead for (dataDate, dataDate + horizon].
export function buildLookahead(model, from, to) {
  const r = { from, to, starting: [], finishing: [], constraintsDue: [], blockedStarts: [] };
  const predsBySucc = new Map();
  for (const p of model.preds) {
    if (!predsBySucc.has(p.taskId)) predsBySucc.set(p.taskId, []);
    predsBySucc.get(p.taskId).push(p);
  }
  for (const t of model.tasks) {
    if (t.status === 'TK_NotStart' && inWin(t.targetStart, from, to)) {
      r.starting.push(t);
      // readiness: an FS predecessor not finished, or SS predecessor not
      // started, means this start is not actually released yet.
      const blockers = [];
      for (const p of predsBySucc.get(t.id) || []) {
        const pred = model.taskById.get(p.predTaskId);
        if (!pred) continue;
        if ((p.type === 'PR_FS' || p.type === 'PR_FF') && pred.status !== 'TK_Complete') blockers.push({ pred, rel: p });
        else if ((p.type === 'PR_SS' || p.type === 'PR_SF') && pred.status === 'TK_NotStart') blockers.push({ pred, rel: p });
      }
      if (blockers.length) r.blockedStarts.push({ t, blockers });
    }
    if (t.status !== 'TK_Complete' && inWin(t.targetEnd, from, to)) r.finishing.push(t);
    if (t.cstrType && inWin(t.cstrDate, from, to)) r.constraintsDue.push(t);
  }
  const byStart = (a, b) => (a.targetStart ?? 0) - (b.targetStart ?? 0);
  r.starting.sort(byStart);
  r.finishing.sort((a, b) => (a.targetEnd ?? 0) - (b.targetEnd ?? 0));
  return r;
}

// Update-integrity QA — is this status update trustworthy?
// Each finding: {id, name, why, tasks: [...]}.
export function updateIntegrity(model) {
  const dd = model.dataDate;
  const dayHrs = (t) => t.cal.dayHrs || 8;
  const findings = [];
  const add = (id, name, why, tasks) => findings.push({ id, name, why, tasks });

  // 1. out-of-sequence progress: started before an FS predecessor finished
  //    (respecting the relationship's lag, converted at the task calendar).
  const oos = [];
  for (const p of model.preds) {
    if (p.type !== 'PR_FS') continue;
    const pred = model.taskById.get(p.predTaskId);
    const succ = model.taskById.get(p.taskId);
    if (!pred || !succ || succ.actStart === undefined) continue;
    const lagDays = (p.lagHrs || 0) / dayHrs(succ);
    if (pred.status !== 'TK_Complete') { oos.push({ succ, pred }); continue; }
    if (pred.actEnd !== undefined) {
      const gapWd = workingDaysBetween(succ.cal, pred.actEnd, succ.actStart);
      if (gapWd < lagDays) oos.push({ succ, pred });
    }
  }
  add('oos-progress', 'Out-of-sequence progress',
    'Work reported as started before its Finish-to-Start predecessor actually finished (lag respected). P6 retained-logic scheduling will distort remaining dates around these.',
    oos.map((x) => x.succ));

  // 2. actual dates in the future
  add('future-actuals', 'Actual dates after the data date',
    'An actual date later than the data date is a record of something that has not happened yet.',
    dd === undefined ? [] : model.tasks.filter((t) =>
      (t.actStart !== undefined && dayFloor(t.actStart) > dayFloor(dd))
      || (t.actEnd !== undefined && dayFloor(t.actEnd) > dayFloor(dd))));

  // 3. status/actual mismatches
  add('complete-no-finish', 'Complete without an actual finish',
    'TK_Complete but act_end_date is empty — the completion date is unrecorded.',
    model.tasks.filter((t) => t.status === 'TK_Complete' && t.actEnd === undefined));
  add('active-no-start', 'In progress without an actual start',
    'TK_Active but act_start_date is empty — progress with no start on record.',
    model.tasks.filter((t) => t.status === 'TK_Active' && t.actStart === undefined));
  add('pct-no-start', 'Physical % without an actual start',
    'phys_complete_pct > 0 on an activity that has never started.',
    model.tasks.filter((t) => (t.physPct ?? 0) > 0 && t.actStart === undefined && t.status === 'TK_NotStart'));
  add('complete-remaining', 'Complete with remaining duration',
    'TK_Complete but remain_drtn_hr_cnt > 0 — finished work cannot have remaining duration.',
    model.tasks.filter((t) => t.status === 'TK_Complete' && (t.remainHrs ?? 0) > 0));

  // 4. un-statused work (stale forecasts)
  add('unstatused', 'Un-statused work (stale forecasts)',
    'Not-started activities whose planned dates are already in the past — the update did not move or status them.',
    dd === undefined ? [] : model.tasks.filter((t) =>
      t.status === 'TK_NotStart' && t.targetStart !== undefined && dayFloor(t.targetStart) < dayFloor(dd)));

  return findings;
}

// Float bands — the planner's near-critical radar.
export function floatBands(model) {
  const bands = [
    { id: 'neg', label: 'Negative float', test: (d) => d < 0, tasks: [] },
    { id: 'crit', label: 'Critical (0 wd)', test: (d) => d === 0, tasks: [] },
    { id: 'near', label: 'Near-critical (≤ 5 wd)', test: (d) => d > 0 && d <= 5, tasks: [] },
    { id: 'mid', label: 'Watch (≤ 20 wd)', test: (d) => d > 5 && d <= 20, tasks: [] },
    { id: 'high', label: 'High float (> 20 wd)', test: (d) => d > 20, tasks: [] },
  ];
  let unmeasured = 0;
  for (const t of model.tasks) {
    if (t.status === 'TK_Complete') continue;
    if (t.floatDays === undefined) { unmeasured++; continue; }
    for (const b of bands) if (b.test(t.floatDays)) { b.tasks.push(t); break; }
  }
  for (const b of bands) b.tasks.sort((a, z) => (a.floatDays ?? 0) - (z.floatDays ?? 0));
  return { bands, unmeasured };
}
