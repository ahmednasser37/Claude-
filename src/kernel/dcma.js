// dcma.js — the DCMA 14-Point Assessment, per DCMA's published spec. Pure.
//
// Every check that needs a baseline or a missing field returns
// {value: null, status: 'na', reason: '<what is missing>'} — never a
// silently-substituted default.

import { workingDaysBetween, dayFloor, fmtDate } from './calendar.js';
import { HARD_CONSTRAINTS } from './model.js';
import { criticalPathTest, runCPM } from './cpm.js';

const pctCheck = (bad, total, limit, dir = 'lt') => {
  if (total === 0) return { value: null, status: 'na', reason: 'No population to measure (0 items).' };
  const pct = bad / total;
  const ok = dir === 'lt' ? pct < limit : pct >= limit;
  return { value: pct, status: ok ? 'pass' : 'fail' };
};

export function runAllChecks(model, { baseline = null } = {}) {
  const tasks = model.tasks;
  const rels = model.preds;
  const dd = model.dataDate;
  const cal = model.projectCal;
  const nonMilestone = tasks.filter((t) => !t.milestone);
  const checks = [];
  const push = (id, name, threshold, formula, r) => checks.push({ id, name, threshold, formula, ...r });

  // 1 — Logic
  {
    const hasPred = new Set(rels.map((r) => r.taskId));
    const hasSucc = new Set(rels.map((r) => r.predTaskId));
    const offenders = nonMilestone.filter((t) => !hasPred.has(t.id) || !hasSucc.has(t.id));
    push(1, 'Logic', '< 5% missing links',
      'Non-milestone activities missing a predecessor and/or successor ÷ total non-milestone activities',
      { ...pctCheck(offenders.length, nonMilestone.length, 0.05), count: offenders.length, total: nonMilestone.length, offenders: offenders.map((t) => t.id) });
  }
  // 2 — Leads
  {
    const offenders = rels.filter((r) => (r.lagHrs || 0) < 0);
    push(2, 'Leads', '< 5% of relationships',
      'Relationships with negative lag ÷ total relationships',
      { ...pctCheck(offenders.length, rels.length, 0.05), count: offenders.length, total: rels.length, offenders: offenders.map((r) => `${r.predTaskId}→${r.taskId}`) });
  }
  // 3 — Lags
  {
    const offenders = rels.filter((r) => (r.lagHrs || 0) > 0);
    push(3, 'Lags', '< 5% of relationships',
      'Relationships with positive lag ÷ total relationships',
      { ...pctCheck(offenders.length, rels.length, 0.05), count: offenders.length, total: rels.length, offenders: offenders.map((r) => `${r.predTaskId}→${r.taskId}`) });
  }
  // 4 — Relationship types
  {
    const fs = rels.filter((r) => r.type === 'PR_FS').length;
    push(4, 'Relationship types', '≥ 90% Finish-to-Start',
      'Finish-to-Start relationships ÷ total relationships',
      { ...pctCheck(fs, rels.length, 0.90, 'ge'), count: fs, total: rels.length, offenders: rels.filter((r) => r.type !== 'PR_FS').map((r) => `${r.predTaskId}→${r.taskId} (${r.type})`) });
  }
  // 5 — Hard constraints
  {
    const offenders = tasks.filter((t) => t.cstrType && HARD_CONSTRAINTS.has(t.cstrType));
    push(5, 'Hard constraints', '< 5% of activities',
      'Activities with Mandatory Start/Finish or Start/Finish-On constraints ÷ total activities',
      { ...pctCheck(offenders.length, tasks.length, 0.05), count: offenders.length, total: tasks.length, offenders: offenders.map((t) => t.id) });
  }
  // 6 — High float (> 44 working days)
  {
    const pool = tasks.filter((t) => t.status !== 'TK_Complete');
    const measurable = pool.filter((t) => t.floatDays !== undefined);
    if (measurable.length === 0) {
      push(6, 'High float', '< 5% of activities', 'Activities with total float > 44 working days ÷ total incomplete activities',
        { value: null, status: 'na', reason: 'total_float_hr_cnt not populated in this file.' });
    } else {
      const offenders = measurable.filter((t) => t.floatDays > 44);
      push(6, 'High float', '< 5% of activities',
        'Activities with total float > 44 working days ÷ total incomplete activities',
        { ...pctCheck(offenders.length, measurable.length, 0.05), count: offenders.length, total: measurable.length, offenders: offenders.map((t) => t.id) });
    }
  }
  // 7 — Negative float
  {
    const measurable = tasks.filter((t) => t.totalFloatHrs !== undefined && t.status !== 'TK_Complete');
    if (measurable.length === 0) {
      push(7, 'Negative float', '0 activities', 'Count of incomplete activities with total float < 0',
        { value: null, status: 'na', reason: 'total_float_hr_cnt not populated in this file.' });
    } else {
      const offenders = measurable.filter((t) => t.totalFloatHrs < 0);
      push(7, 'Negative float', '0 activities', 'Count of incomplete activities with total float < 0',
        { value: offenders.length, status: offenders.length === 0 ? 'pass' : 'fail', count: offenders.length, total: measurable.length, offenders: offenders.map((t) => t.id) });
    }
  }
  // 8 — High duration (> 44 working days)
  {
    const pool = nonMilestone.filter((t) => t.status !== 'TK_Complete' && t.origDays !== undefined);
    const offenders = pool.filter((t) => t.origDays > 44);
    push(8, 'High duration', '< 5% of activities',
      'Incomplete non-milestone activities with original duration > 44 working days ÷ total such activities',
      { ...pctCheck(offenders.length, pool.length, 0.05), count: offenders.length, total: pool.length, offenders: offenders.map((t) => t.id) });
  }
  // 9 — Invalid dates
  {
    if (dd === undefined) {
      push(9, 'Invalid dates', '0 activities', 'Actual dates after the data date, or forecast dates before it',
        { value: null, status: 'na', reason: 'No data date proxy (last_schedule_date / last_recalc_date) in file.' });
    } else {
      const ddDay = dayFloor(dd);
      const offenders = [];
      for (const t of tasks) {
        if ((t.actStart !== undefined && dayFloor(t.actStart) > ddDay)
          || (t.actEnd !== undefined && dayFloor(t.actEnd) > ddDay)) {
          offenders.push({ id: t.id, why: `actual date after data date (${fmtDate(dd)})` });
        } else if (t.status === 'TK_NotStart' && t.targetStart !== undefined && dayFloor(t.targetStart) < ddDay) {
          offenders.push({ id: t.id, why: 'forecast start before data date (not started, not rescheduled)' });
        }
      }
      push(9, 'Invalid dates', '0 activities', 'Actual dates after the data date, or forecast dates before it',
        { value: offenders.length, status: offenders.length === 0 ? 'pass' : 'fail', count: offenders.length, total: tasks.length, offenders: offenders.map((o) => o.id), detail: offenders });
    }
  }
  // 10 — Resources (informational)
  {
    const pool = nonMilestone;
    const offenders = pool.filter((t) => t.assignments.length === 0);
    const r = pctCheck(offenders.length, pool.length, 1.0);
    push(10, 'Resources', 'informational',
      'Non-milestone activities with no resource assignment ÷ total non-milestone activities',
      { value: r.value, status: pool.length === 0 ? 'na' : 'info', reason: pool.length === 0 ? 'No non-milestone activities.' : undefined, count: offenders.length, total: pool.length, offenders: offenders.map((t) => t.id) });
  }
  // 11 — Missed tasks (needs baseline)
  {
    if (!baseline) {
      push(11, 'Missed tasks', '< 5% of baselined activities',
        'Baselined activities whose current finish is later than baseline finish ÷ total matched',
        { value: null, status: 'na', reason: 'Requires a baseline file — none loaded.' });
    } else {
      let matched = 0; const offenders = [];
      for (const t of tasks) {
        const b = baseline.taskByCode.get(t.code);
        if (!b || b.targetEnd === undefined) continue;
        matched++;
        const curFinish = t.actEnd !== undefined ? t.actEnd : t.targetEnd;
        if (curFinish !== undefined && dayFloor(curFinish) > dayFloor(b.targetEnd)) offenders.push(t.id);
      }
      push(11, 'Missed tasks', '< 5% of baselined activities',
        'Baselined activities whose current finish is later than baseline finish ÷ total matched',
        { ...pctCheck(offenders.length, matched, 0.05), count: offenders.length, total: matched, offenders });
    }
  }
  // 12 — Critical Path Test (real CPM perturbation — never a fake pass)
  {
    const r = criticalPathTest(model);
    push(12, 'Critical Path Test', 'finish shifts by the full extension',
      'Extend a driving activity\'s duration by N working days via a real CPM forward/backward pass; project finish must shift by exactly N',
      r.status === 'na' ? { value: null, status: 'na', reason: r.reason }
        : { value: r.shift / r.extendBy, status: r.status, reason: r.reason, detail: r });
  }
  // 13 — CPLI (needs baseline)
  {
    if (!baseline) {
      push(13, 'CPLI', '≥ 0.95',
        '(critical path length + total float of the activity driving project finish) ÷ critical path length, working days',
        { value: null, status: 'na', reason: 'Requires a baseline finish to measure against — none loaded.' });
    } else if (dd === undefined) {
      push(13, 'CPLI', '≥ 0.95', 'CPL-based ratio', { value: null, status: 'na', reason: 'No data date in file.' });
    } else {
      // driving activity = incomplete task with the latest current finish
      // among those with minimum total float — its float, NOT a sum.
      const pool = tasks.filter((t) => t.status !== 'TK_Complete' && t.totalFloatHrs !== undefined && t.targetEnd !== undefined);
      if (pool.length === 0) {
        push(13, 'CPLI', '≥ 0.95', 'CPL-based ratio', { value: null, status: 'na', reason: 'No incomplete activities with float and finish dates.' });
      } else {
        const minFloat = Math.min(...pool.map((t) => t.totalFloatHrs));
        const driving = pool.filter((t) => t.totalFloatHrs === minFloat)
          .reduce((a, b) => (a.targetEnd >= b.targetEnd ? a : b));
        const projFinish = Math.max(...pool.map((t) => t.targetEnd));
        const cpl = workingDaysBetween(cal, dd, projFinish);
        if (!cpl || cpl <= 0) {
          push(13, 'CPLI', '≥ 0.95', 'CPL-based ratio', { value: null, status: 'na', reason: 'Critical path length is 0 working days (data date at/after finish).' });
        } else {
          const floatDays = driving.totalFloatHrs / (driving.cal.dayHrs || 8);
          const cpli = (cpl + floatDays) / cpl;
          push(13, 'CPLI', '≥ 0.95',
            `(CPL ${cpl}d + driving activity ${driving.code} float ${floatDays.toFixed(1)}d) ÷ CPL ${cpl}d`,
            { value: cpli, status: cpli >= 0.95 ? 'pass' : 'fail', detail: { cpl, floatDays, driving: driving.code } });
        }
      }
    }
  }
  // 14 — BEI (needs baseline)
  {
    if (!baseline) {
      push(14, 'BEI', '≥ 0.95',
        'Activities actually finished by the data date ÷ activities baselined to finish by the data date',
        { value: null, status: 'na', reason: 'Requires a baseline file — none loaded.' });
    } else if (dd === undefined) {
      push(14, 'BEI', '≥ 0.95', 'finished ÷ planned-to-finish', { value: null, status: 'na', reason: 'No data date in file.' });
    } else {
      const ddDay = dayFloor(dd);
      let planned = 0, done = 0;
      for (const t of tasks) {
        const b = baseline.taskByCode.get(t.code);
        if (!b || b.targetEnd === undefined) continue;
        if (dayFloor(b.targetEnd) <= ddDay) planned++;
        if (t.actEnd !== undefined && dayFloor(t.actEnd) <= ddDay) done++;
      }
      if (planned === 0) {
        push(14, 'BEI', '≥ 0.95', 'finished ÷ planned-to-finish', { value: null, status: 'na', reason: 'No activities were baselined to finish by the data date.' });
      } else {
        const bei = done / planned;
        push(14, 'BEI', '≥ 0.95', `${done} finished ÷ ${planned} baselined to finish by ${fmtDate(dd)}`,
          { value: bei, status: bei >= 0.95 ? 'pass' : 'fail', count: done, total: planned });
      }
    }
  }

  return checks;
}

export { runCPM };
