// model.js — buildModel(tables) -> one in-memory model every view reads. Pure.
import { num } from './xer-parser.js';
import { parseP6Date, makeCalendar, defaultCalendar, workingDaySpan } from './calendar.js';
import { taskChainage } from './chainage.js';

export const HARD_CONSTRAINTS = new Set(['CS_MANDSTART', 'CS_MANDFIN', 'CS_MSO', 'CS_MEO']);

export function buildModel(parsed) {
  const tables = parsed.tables || parsed; // accept parseXER output or bare map
  const t = (name) => tables[name] || [];

  // --- calendars ---
  const calendars = new Map();
  for (const row of t('CALENDAR')) calendars.set(row.clndr_id, makeCalendar(row));
  const fallbackCal = defaultCalendar();
  const calFor = (id) => (id !== undefined && calendars.has(id) ? calendars.get(id) : fallbackCal);

  // --- project + data date ---
  const project = t('PROJECT')[0] || {};
  // No field named data_date exists in XER. last_recalc_date can be stamped at
  // baseline creation (before the schedule even starts) — prefer
  // last_schedule_date as the "as of" proxy when both exist.
  let dataDate, dataDateSource = null;
  if (project.last_schedule_date) {
    dataDate = parseP6Date(project.last_schedule_date);
    dataDateSource = 'last_schedule_date';
  } else if (project.last_recalc_date) {
    dataDate = parseP6Date(project.last_recalc_date);
    dataDateSource = 'last_recalc_date';
  }
  const projectCal = calFor(project.clndr_id);

  // --- WBS tree ---
  const wbsById = new Map();
  for (const row of t('PROJWBS')) {
    wbsById.set(row.wbs_id, {
      id: row.wbs_id,
      parentId: row.parent_wbs_id,
      shortName: row.wbs_short_name || '',
      name: row.wbs_name || row.wbs_short_name || `WBS ${row.wbs_id}`,
      isProjectNode: row.proj_node_flag === 'Y',
      children: [], tasks: [],
    });
  }
  let wbsRoot = null;
  for (const node of wbsById.values()) {
    const parent = node.parentId !== undefined ? wbsById.get(node.parentId) : undefined;
    const isRoot = node.isProjectNode || !parent || node.parentId === node.id;
    if (isRoot && !wbsRoot) { wbsRoot = node; continue; }
    if (parent && parent !== node) parent.children.push(node);
    else if (!wbsRoot) wbsRoot = node;
  }
  if (!wbsRoot) { // synthesize a root if no row qualifies
    wbsRoot = { id: '__root', parentId: undefined, shortName: 'ROOT', name: 'Project', isProjectNode: true, children: [...wbsById.values()], tasks: [] };
    wbsById.set('__root', wbsRoot);
  } else {
    // orphans (parent id missing from file) attach to root rather than vanish
    for (const node of wbsById.values()) {
      if (node === wbsRoot) continue;
      const parent = wbsById.get(node.parentId);
      if (!parent || parent === node) wbsRoot.children.push(node);
    }
  }

  // --- resources ---
  const rsrcById = new Map();
  for (const row of t('RSRC')) {
    rsrcById.set(row.rsrc_id, {
      id: row.rsrc_id,
      name: row.rsrc_name || row.rsrc_short_name || `Resource ${row.rsrc_id}`,
      shortName: row.rsrc_short_name || '',
      type: row.rsrc_type || 'RT_Labor',
      maxQtyPerHr: undefined, // filled from RSRCRATE below; stays undefined when absent
    });
  }
  for (const row of t('RSRCRATE')) {
    const r = rsrcById.get(row.rsrc_id);
    if (r) r.maxQtyPerHr = num(row.max_qty_per_hr);
  }

  // --- tasks ---
  const tasks = [];
  const taskById = new Map();
  const taskByCode = new Map();
  for (const row of t('TASK')) {
    const cal = calFor(row.clndr_id);
    const task = {
      id: row.task_id,
      code: row.task_code || row.task_id,
      name: row.task_name || '',
      wbsId: row.wbs_id,
      status: row.status_code || 'TK_NotStart',
      taskType: row.task_type,
      targetStart: parseP6Date(row.target_start_date),
      targetEnd: parseP6Date(row.target_end_date),
      actStart: parseP6Date(row.act_start_date),
      actEnd: parseP6Date(row.act_end_date),
      totalFloatHrs: num(row.total_float_hr_cnt),
      remainHrs: num(row.remain_drtn_hr_cnt),
      // 0–100 convention, always. Never re-interpret small values as fractions.
      physPct: num(row.phys_complete_pct),
      cstrType: row.cstr_type,
      cstrDate: parseP6Date(row.cstr_date),
      clndrId: row.clndr_id,
      cal,
      raw: row,
      // filled below
      chainage: null, targetCost: 0, actualCost: 0, assignments: [],
      milestone: false, origDays: undefined, floatDays: undefined,
    };
    task.milestone = task.taskType === 'TT_Mile' || task.taskType === 'TT_FinMile'
      || (task.targetStart !== undefined && task.targetStart === task.targetEnd);
    task.chainage = taskChainage(task);
    if (task.targetStart !== undefined && task.targetEnd !== undefined) {
      task.origDays = workingDaySpan(cal, task.targetStart, task.targetEnd);
      if (task.milestone) task.origDays = 0;
    }
    if (task.totalFloatHrs !== undefined) {
      const dh = cal.dayHrs || 8;
      task.floatDays = task.totalFloatHrs / dh;
    }
    tasks.push(task);
    taskById.set(task.id, task);
    taskByCode.set(task.code, task);
  }

  // --- relationships ---
  const preds = [];
  for (const row of t('TASKPRED')) {
    preds.push({
      taskId: row.task_id,          // SUCCESSOR
      predTaskId: row.pred_task_id, // PREDECESSOR
      type: row.pred_type || 'PR_FS',
      lagHrs: num(row.lag_hr_cnt),
    });
  }

  // --- assignments / costs ---
  const assignments = [];
  for (const row of t('TASKRSRC')) {
    const a = {
      taskId: row.task_id,
      rsrcId: row.rsrc_id,
      targetCost: num(row.target_cost),
      targetQty: num(row.target_qty),
      actRegCost: num(row.act_reg_cost),
      actOtCost: num(row.act_ot_cost),
      actRegQty: num(row.act_reg_qty),
      actOtQty: num(row.act_ot_qty),
      remainQty: num(row.remain_qty),
    };
    assignments.push(a);
    const task = taskById.get(a.taskId);
    if (task) {
      task.assignments.push(a);
      task.targetCost += a.targetCost || 0;
      task.actualCost += (a.actRegCost || 0) + (a.actOtCost || 0);
    }
  }

  // --- attach tasks to WBS nodes ---
  for (const task of tasks) {
    const node = wbsById.get(task.wbsId);
    if (node) node.tasks.push(task);
    else wbsRoot.tasks.push(task);
  }

  const tablesSummary = Object.keys(tables).map((name) => ({ name, rows: tables[name].length }));

  return {
    project, dataDate, dataDateSource, projectCal,
    calendars, defaultCal: fallbackCal,
    wbsRoot, wbsById,
    tasks, taskById, taskByCode,
    preds, rsrcById, assignments,
    tablesSummary,
    header: parsed.header || null,
    raw: tables,
  };
}
