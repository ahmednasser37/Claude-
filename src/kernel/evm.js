// evm.js — PV/EV/AC/SPI/CPI/EAC/TCPI per PMI/AACE convention. Pure.
//
// The one rule that must never erode: a single XER file contains ONE
// time-phased plan and ONE snapshot of actuals. PV is a legitimate full
// curve; EV and AC are exactly one point each, at the data date. Nothing in
// this module produces a historical EV/AC series, and no view may invent one.

import { spreadAcrossPeriods, periodStart, dayFloor, DAY_MS, hoursOnDay } from './calendar.js';

// Earned % for one activity at asOfDate. phys_complete_pct is 0–100, always
// divided by 100 — there is no valid P6 convention where it is natively 0–1.
// Fallback is schedule-elapsed, clamped [0,1], forced to 0 with no actual
// start: an unstarted activity has 0% earned even if its window has elapsed.
export function computeEarnedPct(task, asOf) {
  if (task.status === 'TK_Complete') return 1;
  if (task.physPct !== undefined && task.physPct !== 0) {
    return Math.min(Math.max(task.physPct / 100, 0), 1);
  }
  if (task.actStart === undefined) return 0;
  if (task.targetStart === undefined || task.targetEnd === undefined || asOf === undefined) return 0;
  const span = task.targetEnd - task.targetStart;
  if (span <= 0) return 0;
  return Math.min(Math.max((asOf - task.targetStart) / span, 0), 1);
}

export function computeEVM(model, gran = 'month') {
  const asOf = model.dataDate;
  const pvMap = new Map();
  let bac = 0, ev = 0, ac = 0;
  for (const task of model.tasks) {
    const cost = task.targetCost || 0;
    bac += cost;
    ac += task.actualCost || 0;
    if (cost > 0) {
      ev += cost * computeEarnedPct(task, asOf);
      spreadAcrossPeriods(task.cal, task.targetStart, task.targetEnd, cost, gran, pvMap);
    }
  }

  const keys = [...pvMap.keys()].sort();
  let cum = 0;
  const pv = keys.map((key) => {
    const planned = pvMap.get(key);
    cum += planned;
    return { key, start: periodStart(key, gran), planned, cum };
  });

  // PV at the data date: cumulative plan cost of all working days <= data date.
  let pvAtDD;
  if (asOf !== undefined) {
    pvAtDD = 0;
    for (const task of model.tasks) {
      const cost = task.targetCost || 0;
      if (cost <= 0 || task.targetStart === undefined || task.targetEnd === undefined) continue;
      const a = dayFloor(task.targetStart), b = dayFloor(task.targetEnd), dd = dayFloor(asOf);
      if (dd < a) continue;
      if (dd >= b) { pvAtDD += cost; continue; }
      let total = 0, upto = 0;
      for (let d = a; d <= b; d += DAY_MS) {
        const h = hoursOnDay(task.cal, d);
        total += h;
        if (d <= dd) upto += h;
      }
      pvAtDD += total > 0 ? cost * (upto / total) : cost;
    }
  }

  // N/A vs zero, kept distinct on purpose:
  //  - PV legitimately 0 (data date before schedule start) -> SPI not computable.
  //  - PV > 0 with EV 0 -> a real, alarming SPI of 0.
  const spi = pvAtDD === undefined ? { value: null, reason: 'No data date in file — PV at "now" is undefined.' }
    : pvAtDD === 0 ? { value: null, reason: 'PV is 0 at the data date (data date precedes plan start) — SPI not computable.' }
    : { value: ev / pvAtDD };
  const cpi = ac === 0
    ? (ev === 0 ? { value: null, reason: 'No actual cost and no earned value recorded yet — CPI not computable.' }
                : { value: null, reason: 'Earned value exists but actual cost is 0 — check TASKRSRC actuals.' })
    : { value: ev / ac };

  const eac = cpi.value ? ac + (bac - ev) / cpi.value : undefined;
  const etc = eac !== undefined ? eac - ac : undefined;
  const vac = eac !== undefined ? bac - eac : undefined;
  const tcpi = bac - ac !== 0 ? (bac - ev) / (bac - ac) : undefined;
  const earnedPct = bac > 0 ? ev / bac : undefined;

  const es = earnedSchedule(pv, ev, asOf, gran);

  return {
    gran, pv, pvAtDD,
    evPoint: asOf !== undefined ? { date: asOf, value: ev } : null,
    acPoint: asOf !== undefined ? { date: asOf, value: ac } : null,
    bac, ev, ac, spi, cpi, eac, etc, vac, tcpi, earnedPct, es,
  };
}

// Earned Schedule per Lipke: ES = the point on the PLAN's own timeline at
// which cumulative PV equals today's EV (whole periods + linear fraction);
// AT = periods elapsed from plan start to the data date. SPI(t) = ES / AT,
// SV(t) = ES − AT, in period units. Unlike cost-based SPI, SPI(t) does not
// converge to 1.0 as the project limps to completion.
export function earnedSchedule(pv, ev, asOf, gran = 'month') {
  if (!pv.length) return { value: null, reason: 'No time-phased plan (no costed activities).' };
  if (asOf === undefined) return { value: null, reason: 'No data date in file.' };
  const unit = gran === 'week' ? 'weeks' : 'months';
  // AT: periods from plan start to the data date (fractional)
  const first = pv[0].start;
  const last = pv[pv.length - 1].start;
  const periodMs = pv.length > 1 ? (last - first) / (pv.length - 1) : DAY_MS * 30;
  const at = (asOf - first) / periodMs;
  if (at <= 0) return { value: null, reason: 'Data date precedes the plan start — AT is 0.' };
  // ES: whole periods where cum PV <= EV, plus interpolated fraction
  let es;
  if (ev <= 0) es = 0;
  else if (ev >= pv[pv.length - 1].cum) es = pv.length;
  else {
    let n = 0;
    while (n < pv.length && pv[n].cum <= ev) n++;
    const prevCum = n === 0 ? 0 : pv[n - 1].cum;
    const stepCum = pv[n].cum - prevCum;
    es = n + (stepCum > 0 ? (ev - prevCum) / stepCum : 0);
  }
  return {
    value: es / at,     // SPI(t)
    es, at, unit,
    svt: es - at,       // SV(t): negative = periods behind, in time units
  };
}
