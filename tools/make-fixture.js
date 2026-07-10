// make-fixture.js — deterministic generator for the demo XER fixtures.
// Emits tests/fixtures/najd-s2-update.xer (current, progressed to DD 2026-07-01),
// tests/fixtures/najd-s2-baseline.xer (baseline, no progress), and
// src/data/demo.js (the same text embedded for the browser app).
//
// The project: NAJD Water Transmission — Section 2 (KP512–KP536), a 24 km
// 48" pipeline on a Sun–Thu site calendar with 2025/26 KSA holidays.
// Every DCMA offender in it is engineered and known, so tests can assert
// exact counts.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;
const U = (y, m, d) => Date.UTC(y, m - 1, d);
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
const serial = (ms) => (ms - SERIAL_EPOCH) / DAY;

// --- site calendar: Sun–Thu, 07:00–15:00, KSA holidays -----------------------
const HOLIDAYS = [U(2025, 9, 23), U(2026, 3, 19), U(2026, 3, 22), U(2026, 3, 23)];
const HALF_DAYS = [U(2026, 3, 18)]; // 07:00–11:00 before Eid
const holidaySet = new Set(HOLIDAYS);

const isWork = (ms) => {
  const p6 = new Date(ms).getUTCDay() + 1; // 1=Sun..7=Sat
  return p6 >= 1 && p6 <= 5 && !holidaySet.has(ms);
};
const nextWork = (ms) => { while (!isWork(ms)) ms += DAY; return ms; };
const addWD = (ms, n) => { ms = nextWork(ms); while (n > 0) { ms += DAY; if (isWork(ms)) n--; } return ms; };
const fmt = (ms, hm) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${hm}`;
};
const S = (ms) => fmt(ms, '07:00'); // starts
const F = (ms) => fmt(ms, '15:00'); // finishes

const PS = nextWork(U(2025, 9, 7)); // project start (Sunday)
const DD = U(2026, 7, 1);           // data date
const off = (n) => addWD(PS, n);

// --- calendars ----------------------------------------------------------------
function clndrData(workingDays, shift, exceptions) {
  let days = '';
  for (let d = 1; d <= 7; d++) {
    days += `(0||${d}()(${workingDays.includes(d) ? `(0||0(s|${shift.s}|f|${shift.f})())` : ''}))`;
  }
  const ex = exceptions
    .map((e, i) => `(0||${i}(d|${serial(e.day)})(${e.shift ? `(0||0(s|${e.shift.s}|f|${e.shift.f})())` : ''}))`)
    .join('');
  return `(0||CalendarData()((0||DaysOfWeek()(${days}))(0||VIEW(ShowTotal|N)())(0||Exceptions()(${ex}))))`;
}
const SITE_CAL = clndrData([1, 2, 3, 4, 5], { s: '07:00', f: '15:00' }, [
  ...HOLIDAYS.map((day) => ({ day })),
  ...HALF_DAYS.map((day) => ({ day, shift: { s: '07:00', f: '11:00' } })),
]);
const OFFICE_CAL = clndrData([1, 2, 3, 4, 5], { s: '08:00', f: '16:00' }, []);

// --- WBS -----------------------------------------------------------------------
const WBS = [
  ['5000', '', 'NAJD-S2', 'NAJD Water Transmission — Section 2', 'Y'],
  ['5010', '5000', 'GEN', 'General & Milestones', 'N'],
  ['5020', '5000', 'PROC', 'Procurement', 'N'],
  ['5030', '5000', 'PIPE', 'Pipeline Works', 'N'],
  ['5031', '5030', 'SEG-A', 'Segment A — KP512+000 to KP518+000', 'N'],
  ['5032', '5030', 'SEG-B', 'Segment B — KP518+000 to KP524+000', 'N'],
  ['5033', '5030', 'SEG-C', 'Segment C — KP524+000 to KP530+000', 'N'],
  ['5034', '5030', 'SEG-D', 'Segment D — KP530+000 to KP536+000', 'N'],
  ['5040', '5000', 'STX', 'Stations & Crossings', 'N'],
  ['5050', '5000', 'TC', 'Testing & Commissioning', 'N'],
];

// --- resources ------------------------------------------------------------------
const RSRC = [
  ['201', 'EW-CREW', 'Earthworks Crew', 'RT_Labor', 2],       // has ceiling
  ['202', 'WELD-CREW', 'Welding & NDT Crew', 'RT_Labor', 2],  // has ceiling
  ['203', 'SIDEBOOM', 'Sideboom Spread', 'RT_Equip', 1],      // has ceiling (over-alloc engineered)
  ['204', 'EXCAV', '30t Excavator Fleet', 'RT_Equip', null],  // NO RSRCRATE -> "ceiling unavailable"
  ['205', 'PIPE-48', 'Pipe 48in CS API 5L', 'RT_Mat', null],
  ['206', 'HDD-RIG', 'HDD Maxi Rig', 'RT_Equip', 1],
  ['207', 'QAQC', 'QA/QC Engineers', 'RT_Labor', null],
];

// --- activities -------------------------------------------------------------------
// {code, name, wbs, off, dur(wd), ms(milestone), preds:[[code,type,lagHrs]],
//  cstr:[type, dateMs], float(hrs), rsrc:[[rid, cost, qty]],
//  st('C'|'A'|'N'), pct, actStartOff, slip(wd, actual start delay), acMult}
const SEG = (tag, wbs, kpA, kpB, base, opts = {}) => {
  const kp = (k) => `KP${String(Math.floor(k)).padStart(3, '0')}+${String(Math.round((k % 1) * 1000)).padStart(3, '0')}`;
  const span = `${kp(kpA)} to ${kp(kpB)}`;
  const weldDur = opts.weldDur ?? 30;
  return [
    { code: `${tag}-010`, name: `Survey & Set-out ${span}`, wbs, off: base, dur: 5, rsrc: [['207', 120000, 40]] },
    { code: `${tag}-020`, name: `ROW Clearing & Grading ${span}`, wbs, off: base + 5, dur: 12, preds: [[`${tag}-010`, 'PR_FS', 0]], rsrc: [['201', 300000, 96], ['204', 150000, 96]] },
    { code: `${tag}-030`, name: `Trench Excavation ${span}`, wbs, off: base + 17, dur: 25, preds: [[`${tag}-020`, 'PR_FS', 0]], rsrc: [['201', 800000, 200], ['204', 600000, 200]] },
    { code: `${tag}-040`, name: `Pipe Stringing ${span}`, wbs, off: base + 22, dur: 10, preds: [[`${tag}-030`, 'PR_SS', 40]], rsrc: [['203', 600000, 80], ['205', 3200000, 6000]] },
    { code: `${tag}-050`, name: `Welding & NDT ${span}`, wbs, off: base + 32, dur: weldDur, preds: [[`${tag}-040`, 'PR_FS', 0]], rsrc: [['202', 1800000, weldDur * 8]] },
    { code: `${tag}-060`, name: `Lower-in & Backfill ${span}`, wbs, off: base + 62, dur: 18, preds: [[`${tag}-050`, 'PR_FS', 0]], rsrc: [['203', 500000, 144], ['201', 400000, 144]] },
    { code: `${tag}-070`, name: `Reinstatement ${span}`, wbs, off: base + 80, dur: 10, preds: [[`${tag}-060`, 'PR_FS', 0]], rsrc: [['201', 400000, 80]] },
  ];
};

function currentActivities() {
  const acts = [
    { code: 'A-000', name: 'Notice to Proceed', wbs: '5010', off: 0, ms: true, type: 'TT_Mile', st: 'C' },
    { code: 'A-010', name: 'Mobilization & Temporary Works', wbs: '5010', off: 0, dur: 20, preds: [['A-000', 'PR_FS', 0]], rsrc: [['201', 1500000, 160]], st: 'C', acMult: 1.10 },
    { code: 'A-020', name: 'Site Facilities & Access Roads', wbs: '5010', off: 20, dur: 30, preds: [['A-010', 'PR_FS', 0]], rsrc: [['204', 1200000, 240]], st: 'C', acMult: 1.05 },
    { code: 'P-010', name: 'Pipe Mill Order & Manufacture', wbs: '5020', off: 0, dur: 110, preds: [['A-000', 'PR_FS', 0]], rsrc: [['205', 2000000, 0]], st: 'C', acMult: 1.02, cal: '101' },
    { code: 'P-020', name: 'Pipe Delivery Lot 1 — Segments A and B', wbs: '5020', off: 90, dur: 15, preds: [['P-010', 'PR_FF', 80]], rsrc: [['205', 800000, 0]], st: 'C', acMult: 1.00, cal: '101' },
    { code: 'P-030', name: 'Pipe Delivery Lot 2 — Segments C and D', wbs: '5020', off: 170, dur: 15, preds: [['P-010', 'PR_FS', 0]], rsrc: [['205', 800000, 0]], st: 'A', pct: 60, slip: 30, remain: 48, acMult: 0.62, float: 160, cal: '101' },
    { code: 'P-040', name: 'Valves & Fittings Procurement', wbs: '5020', off: 200, dur: 20, preds: [['P-010', 'PR_FS', 0]], float: 480, rsrc: [['207', 600000, 0]], st: 'N', cal: '101' }, // high float + stale forecast
    ...SEG('S31', '5031', 512, 518, 20),
    ...SEG('S32', '5032', 518, 524, 65),
    ...SEG('S33', '5033', 524, 530, 110),
    ...SEG('S34', '5034', 530, 536, 155, { weldDur: 46 }), // 46 wd -> DCMA-8 offender
    { code: 'C-010', name: 'Wadi Hanifa HDD Crossing KP529+800', wbs: '5040', off: 140, dur: 35, preds: [['S33-030', 'PR_FS', -40]], rsrc: [['206', 2500000, 280]], st: 'A', pct: 45, slip: 12, remain: 160, acMult: 0.55, float: 24 }, // lead -> DCMA-2
    { code: 'C-020', name: 'Pump Station 2 Tie-in KP536+000', wbs: '5040', off: 250, dur: 10, preds: [['S34-070', 'PR_FS', 0]], cstr: ['CS_MEO', 254], rsrc: [['202', 700000, 80]], st: 'N', float: 40 }, // no successor -> DCMA-1; hard constraint -> DCMA-5
    { code: 'C-030', name: 'Cathodic Protection System — Section 2 Mainline', wbs: '5040', off: 235, dur: 25, rsrc: [['207', 900000, 200]], st: 'N', float: 120 }, // no predecessor -> DCMA-1
    { code: 'T-010', name: 'Hydrostatic Test — Section 2 Mainline', wbs: '5050', off: 230, dur: 15, preds: [['S34-060', 'PR_FS', 0], ['S33-070', 'PR_FS', 0], ['S31-070', 'PR_FS', 0], ['S32-070', 'PR_FS', 0], ['C-010', 'PR_FS', 0], ['P-040', 'PR_FS', 0]], rsrc: [['207', 500000, 120]], st: 'N', float: -40 },
    { code: 'T-020', name: 'Golden Weld Tie-in KP518+400', wbs: '5050', off: 246, dur: 5, preds: [['S33-050', 'PR_FS', 0]], rsrc: [['202', 300000, 40]], st: 'N', float: 80 }, // chainage OOS: succ KP518.4 behind pred KP524-530
    { code: 'T-030', name: 'Pre-commissioning & Dewatering', wbs: '5050', off: 246, dur: 12, preds: [['T-010', 'PR_FS', 0], ['T-020', 'PR_FS', 0]], rsrc: [['207', 400000, 96]], st: 'N', float: -40 },
    { code: 'M-100', name: 'Section 2 Mechanical Completion', wbs: '5010', off: 258, ms: true, type: 'TT_FinMile', preds: [['T-030', 'PR_FS', 0], ['C-030', 'PR_FS', 0]], cstr: ['CS_MANDFIN', 253], st: 'N', float: -40 },
    { code: 'M-110', name: 'Handover to Operations', wbs: '5010', off: 258, ms: true, type: 'TT_FinMile', preds: [['M-100', 'PR_FS', 80]], st: 'N', float: -40 },
  ];
  // progress statuses per segment: A complete, B complete, C mixed, D early works
  const status = {
    S31: { all: 'C', acMult: 1.08 },
    S32: { all: 'C', acMult: 1.12 },
    S33: { '010': 'C', '020': 'C', '030': 'C', '040': 'C', '050': ['A', 55, 8, 120], '060': 'N', '070': 'N', acMult: 1.09, floats: { '050': 0, '060': 0, '070': 40 } },
    S34: { '010': 'C', '020': ['A', 30, 10, 80], '030': 'N', '040': 'N', '050': 'N', '060': 'N', '070': 'N', acMult: 1.06, floats: { '020': -40, '030': -40, '040': -40, '050': -40, '060': -40, '070': -40 } },
  };
  for (const a of acts) {
    const m = /^(S3[1-4])-(\d{3})$/.exec(a.code);
    if (!m) continue;
    const cfg = status[m[1]];
    const st = cfg.all || cfg[m[2]];
    if (Array.isArray(st)) {
      a.st = 'A'; a.pct = st[1]; a.slip = st[2]; a.remain = st[3]; a.acMult = (cfg.acMult || 1) * (st[1] / 100) * 0.95;
    } else {
      a.st = st;
      if (st === 'C') a.acMult = cfg.acMult || 1.05;
    }
    if (cfg.floats && cfg.floats[m[2]] !== undefined) a.float = cfg.floats[m[2]];
    else if (a.st === 'N') a.float = a.float ?? 60;
  }
  addExtraLinks(acts);
  return acts;
}

// staggered segment waves + pipe deliveries feeding stringing
function addExtraLinks(acts) {
  const extra = [
    ['S31-010', 'A-020', 'PR_FS', 0],
    ['S32-010', 'S31-020', 'PR_FS', 0],
    ['S33-010', 'S32-020', 'PR_FS', 0],
    ['S34-010', 'S33-020', 'PR_FS', 0],
    ['S31-040', 'P-020', 'PR_FS', 0],
    ['S34-040', 'P-030', 'PR_FS', 0],
  ];
  for (const [succ, pred, type, lag] of extra) {
    const a = acts.find((x) => x.code === succ);
    (a.preds = a.preds || []).push([pred, type, lag]);
  }
}

function baselineActivities() {
  const acts = [
    { code: 'A-000', name: 'Notice to Proceed', wbs: '5010', off: 0, ms: true, type: 'TT_Mile' },
    { code: 'A-010', name: 'Mobilization & Temporary Works', wbs: '5010', off: 0, dur: 20, preds: [['A-000', 'PR_FS', 0]], rsrc: [['201', 1500000, 160]] },
    { code: 'A-020', name: 'Site Facilities & Access Roads', wbs: '5010', off: 20, dur: 30, preds: [['A-010', 'PR_FS', 0]], rsrc: [['204', 1200000, 240]] },
    { code: 'P-010', name: 'Pipe Mill Order & Manufacture', wbs: '5020', off: 0, dur: 110, preds: [['A-000', 'PR_FS', 0]], rsrc: [['205', 2000000, 0]], cal: '101' },
    { code: 'P-020', name: 'Pipe Delivery Lot 1 — Segments A and B', wbs: '5020', off: 90, dur: 15, preds: [['P-010', 'PR_FF', 80]], rsrc: [['205', 800000, 0]], cal: '101' },
    { code: 'P-030', name: 'Pipe Delivery Lot 2 — Segments C and D', wbs: '5020', off: 150, dur: 15, preds: [['P-010', 'PR_FS', 0]], rsrc: [['205', 800000, 0]], cal: '101' },
    { code: 'P-040', name: 'Valves & Fittings Procurement', wbs: '5020', off: 180, dur: 20, preds: [['P-010', 'PR_FS', 0]], float: 480, rsrc: [['207', 600000, 0]], cal: '101' },
    ...SEG('S31', '5031', 512, 518, 20),
    { code: 'S31-025', name: 'Dewatering Trial KP513+000', wbs: '5031', off: 30, dur: 8, preds: [['S31-020', 'PR_FS', 0]], rsrc: [['204', 250000, 64]] }, // removed in current
    ...SEG('S32', '5032', 518, 524, 60),
    ...SEG('S33', '5033', 524, 530, 100),
    ...SEG('S34', '5034', 530, 536, 140), // baseline weld = 30 wd (current grew to 46)
    { code: 'C-010', name: 'Wadi Hanifa HDD Crossing KP529+800', wbs: '5040', off: 130, dur: 35, preds: [['S33-030', 'PR_FS', -40]], rsrc: [['206', 2500000, 280]] },
    { code: 'C-020', name: 'Pump Station 2 Tie-in KP536+000', wbs: '5040', off: 225, dur: 10, preds: [['S34-070', 'PR_FS', 0]], cstr: ['CS_MEO', 229], rsrc: [['202', 700000, 80]], float: 40 },
    { code: 'T-010', name: 'Hydrostatic Test — Section 2 Mainline', wbs: '5050', off: 205, dur: 15, preds: [['S34-060', 'PR_FS', 0], ['S33-070', 'PR_FS', 0], ['S31-070', 'PR_FS', 0], ['S32-070', 'PR_FS', 0], ['C-010', 'PR_FS', 0], ['P-040', 'PR_FS', 0]], rsrc: [['207', 500000, 120]], float: 0 },
    { code: 'T-020', name: 'Golden Weld Tie-in KP518+400', wbs: '5050', off: 221, dur: 5, preds: [['S33-050', 'PR_FS', 0]], rsrc: [['202', 300000, 40]], float: 80 },
    { code: 'T-030', name: 'Pre-commissioning & Dewatering', wbs: '5050', off: 221, dur: 12, preds: [['T-010', 'PR_FS', 0], ['T-020', 'PR_FS', 0]], rsrc: [['207', 400000, 96]], float: 0 },
    { code: 'M-100', name: 'Section 2 Mechanical Completion', wbs: '5010', off: 233, ms: true, type: 'TT_FinMile', preds: [['T-030', 'PR_FS', 0]], cstr: ['CS_MANDFIN', 253], float: 0 },
    { code: 'M-110', name: 'Handover to Operations', wbs: '5010', off: 233, ms: true, type: 'TT_FinMile', preds: [['M-100', 'PR_FS', 80]], float: 0 },
  ];
  for (const a of acts) { a.st = 'N'; a.float = a.float ?? 80; }
  addExtraLinks(acts);
  return acts;
}

// --- XER emission -----------------------------------------------------------------
function emitXER({ acts, isBaseline }) {
  const L = [];
  const row = (...cells) => L.push(cells.map((c) => (c === undefined || c === null ? '' : String(c))).join('\t'));
  row('ERMHDR', '19.12', isBaseline ? '2025-08-15' : '2026-07-01', 'Project', 'admin', 'PRISM demo export', 'dbxDatabaseNoName', 'Project Management', 'SAR');

  row('%T', 'CALENDAR');
  row('%F', 'clndr_id', 'clndr_name', 'day_hr_cnt', 'clndr_data');
  row('%R', '100', 'NAJD Site — Sun-Thu 8h (KSA)', '8', SITE_CAL);
  row('%R', '101', 'NAJD Office — Sun-Thu 8h', '8', OFFICE_CAL);

  // resolve dates
  const byCode = new Map();
  let nextId = 10001;
  for (const a of acts) {
    a.id = String(nextId++);
    a.tsMs = off(a.off);
    a.teMs = a.ms ? a.tsMs : addWD(a.tsMs, (a.dur ?? 1) - 1);
    if (a.st === 'C') { a.asMs = a.tsMs; a.aeMs = a.teMs; }
    else if (a.st === 'A') { a.asMs = addWD(a.tsMs, a.slip ?? 0); }
    byCode.set(a.code, a);
  }
  const planEnd = Math.max(...acts.map((a) => a.teMs));

  row('%T', 'PROJECT');
  row('%F', 'proj_id', 'proj_short_name', 'plan_start_date', 'plan_end_date', 'last_recalc_date', 'last_schedule_date', 'clndr_id');
  row('%R', '1001', 'NAJD-S2', S(PS), F(planEnd), '2025-08-15 08:00',
    isBaseline ? '' : fmt(DD, '07:00'), '100');

  row('%T', 'PROJWBS');
  row('%F', 'wbs_id', 'parent_wbs_id', 'wbs_short_name', 'wbs_name', 'proj_node_flag');
  for (const w of WBS) row('%R', ...w);

  row('%T', 'RSRC');
  row('%F', 'rsrc_id', 'rsrc_short_name', 'rsrc_name', 'rsrc_type');
  for (const [id, sn, name, type] of RSRC) row('%R', id, sn, name, type);

  row('%T', 'RSRCRATE');
  row('%F', 'rsrc_rate_id', 'rsrc_id', 'max_qty_per_hr');
  let rrId = 301;
  for (const [id, , , , max] of RSRC) if (max !== null) row('%R', String(rrId++), id, String(max));

  const taskFields = ['task_id', 'task_code', 'task_name', 'wbs_id', 'proj_id', 'task_type', 'status_code',
    'target_start_date', 'target_end_date', 'act_start_date', 'act_end_date',
    'total_float_hr_cnt', 'remain_drtn_hr_cnt', 'phys_complete_pct', 'cstr_type', 'cstr_date', 'clndr_id'];
  const taskRow = (a) => {
    const statusCode = a.st === 'C' ? 'TK_Complete' : a.st === 'A' ? 'TK_Active' : 'TK_NotStart';
    const remain = a.st === 'C' ? 0 : a.st === 'A' ? (a.remain ?? (a.dur ?? 1) * 4) : a.ms ? 0 : (a.dur ?? 1) * 8;
    const pct = a.st === 'C' ? 100 : a.st === 'A' ? (a.pct ?? '') : '';
    row('%R', a.id, a.code, a.name, a.wbs, '1001', a.type || (a.ms ? 'TT_Mile' : 'TT_Task'), statusCode,
      S(a.tsMs), a.ms ? S(a.teMs) : F(a.teMs),
      a.asMs !== undefined ? S(a.asMs) : '', a.aeMs !== undefined ? F(a.aeMs) : '',
      a.st === 'C' ? '' : (a.float ?? ''), remain, pct,
      a.cstr ? a.cstr[0] : '', a.cstr ? F(off(a.cstr[1])) : '', a.cal || '100');
  };

  // TASK deliberately split across two %T blocks (append rule under test)
  const half = Math.ceil(acts.length / 2);
  row('%T', 'TASK');
  row('%F', ...taskFields);
  for (const a of acts.slice(0, half)) taskRow(a);

  row('%T', 'TASKPRED');
  row('%F', 'task_pred_id', 'task_id', 'pred_task_id', 'pred_type', 'lag_hr_cnt');
  let tpId = 20001;
  for (const a of acts) {
    for (const [predCode, type, lag] of a.preds || []) {
      const p = byCode.get(predCode);
      if (!p) throw new Error(`unknown predecessor ${predCode} of ${a.code}`);
      row('%R', String(tpId++), a.id, p.id, type, String(lag));
    }
  }

  row('%T', 'TASKRSRC');
  row('%F', 'taskrsrc_id', 'task_id', 'rsrc_id', 'target_cost', 'target_qty', 'act_reg_cost', 'act_ot_cost', 'act_reg_qty', 'act_ot_qty', 'remain_qty');
  let trId = 30001;
  for (const a of acts) {
    for (const [rid, cost, qty] of a.rsrc || []) {
      const mult = a.acMult ?? 0;
      const actCost = isBaseline ? 0 : Math.round(cost * mult);
      const ot = actCost > 0 ? Math.round(actCost * 0.06) : 0;
      const actQty = isBaseline ? 0 : Math.round(qty * Math.min(mult, 1));
      row('%R', String(trId++), a.id, rid, String(cost), String(qty),
        actCost ? String(actCost - ot) : '', ot ? String(ot) : '',
        actQty ? String(actQty) : '', '', String(Math.max(qty - actQty, 0)));
    }
  }

  row('%T', 'TASK'); // second block of the SAME logical table
  row('%F', ...taskFields);
  for (const a of acts.slice(half)) taskRow(a);

  row('%E');
  return L.join('\n') + '\n';
}

const current = emitXER({ acts: currentActivities(), isBaseline: false });
const baseline = emitXER({ acts: baselineActivities(), isBaseline: true });

fs.mkdirSync(path.join(ROOT, 'tests/fixtures'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src/data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/najd-s2-update.xer'), current);
fs.writeFileSync(path.join(ROOT, 'tests/fixtures/najd-s2-baseline.xer'), baseline);
fs.writeFileSync(path.join(ROOT, 'src/data/demo.js'),
  `// GENERATED by tools/make-fixture.js — do not edit by hand.\n`
  + `export const DEMO_NAME = 'najd-s2-update.xer';\n`
  + `export const BASELINE_NAME = 'najd-s2-baseline.xer';\n`
  + `export const DEMO_XER = ${JSON.stringify(current)};\n`
  + `export const BASELINE_XER = ${JSON.stringify(baseline)};\n`);

console.log(`wrote fixtures: current ${current.length} bytes, baseline ${baseline.length} bytes`);
