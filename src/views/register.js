// Activity Register — the full "listing of all work activities as of the
// data date" that DOT-style schedule narratives mandate: ID, description,
// original/remaining duration, total float, dates, calendar — groupable by
// WBS or by any activity code type in the file (Area / Phase / …), sortable,
// filterable, exportable.
import { fmtDate } from '../kernel/calendar.js';
import { openModal } from '../ui/modal.js';
import { esc, taskModalBody, downloadCSV, isoDate, naTag } from '../ui/components.js';

const REG_COLS = [
  ['code', 'Activity ID', (t) => t.code, false],
  ['name', 'Description', (t) => t.name, false],
  ['od', 'OD (wd)', (t) => t.origDays, true],
  ['rd', 'RD (wd)', (t) => t.remainHrs !== undefined ? t.remainHrs / (t.cal.dayHrs || 8) : undefined, true],
  ['tf', 'TF (wd)', (t) => t.floatDays, true],
  ['start', 'Start', (t) => t.actStart ?? t.targetStart, true],
  ['finish', 'Finish', (t) => t.actEnd ?? t.targetEnd, true],
  ['status', 'Status', (t) => t.status, false],
];

function regCell(key, v) {
  if (v === undefined) return `<td class="num">${naTag('not in file')}</td>`;
  if (key === 'start' || key === 'finish') return `<td class="num">${fmtDate(v)}</td>`;
  if (key === 'od' || key === 'rd' || key === 'tf') return `<td class="num">${(+v).toFixed(key === 'tf' ? 1 : 0)}</td>`;
  if (key === 'status') return `<td>${{ TK_Complete: 'complete', TK_Active: 'in progress', TK_NotStart: 'not started' }[v] || esc(v)}</td>`;
  return `<td class="${key === 'code' ? 'num' : ''}">${esc(String(v))}</td>`;
}

function regGroups(store) {
  const m = store.model;
  const g = store.regState.groupBy;
  const q = (store.regState.q || '').toLowerCase();
  const tasks = m.tasks.filter((t) => !q || t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
  const [key, dir] = store.regState.sort;
  const col = REG_COLS.find((c) => c[0] === key);
  const sorted = [...tasks].sort((a, b) => {
    const va = col[2](a), vb = col[2](b);
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return dir === 'asc' ? cmp : -cmp;
  });
  if (g === 'none') return [{ label: null, tasks: sorted }];
  if (g === 'wbs') {
    const map = new Map();
    for (const t of sorted) {
      const node = m.wbsById.get(t.wbsId);
      const label = node ? node.name : '(unplaced)';
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(t);
    }
    return [...map.entries()].map(([label, ts]) => ({ label, tasks: ts }));
  }
  // group by an activity code type
  const type = m.codeTypes.get(g);
  const map = new Map();
  const un = [];
  for (const t of sorted) {
    const hit = t.codes.find((c) => c.type.id === g);
    if (!hit) { un.push(t); continue; }
    const label = `${hit.value.shortName} — ${hit.value.name}`;
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(t);
  }
  const out = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, ts]) => ({ label, tasks: ts }));
  if (un.length) out.push({ label: `(no ${type ? type.name : 'code'} assigned)`, tasks: un });
  return out;
}

export const ViewRegister = {
  id: 'register', title: 'Activity Register', group: 'Reporting',
  chip(store) {
    return `<span class="num">${store.model.tasks.length}</span> activities`;
  },
  render(el, store) {
    const m = store.model;
    if (!store.regState) store.regState = { groupBy: 'wbs', q: '', sort: ['start', 'asc'] };
    const st = store.regState;
    const groups = regGroups(store);
    const shown = groups.reduce((a, g) => a + g.tasks.length, 0);
    const [sortKey, sortDir] = st.sort;

    el.innerHTML = `
      <div class="section">
        <h2>Activity register</h2>
        <p class="sub">The full listing as of the data date (${fmtDate(m.dataDate)}) — the table a schedule narrative appends. Group by WBS or by any activity code in the file; click a column to sort, a row for detail.</p>
        <div class="filterrow">
          <input type="search" data-reg-q placeholder="filter code / name…" value="${esc(st.q)}" aria-label="Filter activities">
          <select data-reg-group aria-label="Group by">
            <option value="wbs" ${st.groupBy === 'wbs' ? 'selected' : ''}>Group: WBS</option>
            ${[...m.codeTypes.values()].map((ct) => `<option value="${esc(ct.id)}" ${st.groupBy === ct.id ? 'selected' : ''}>Group: ${esc(ct.name)}</option>`).join('')}
            <option value="none" ${st.groupBy === 'none' ? 'selected' : ''}>No grouping</option>
          </select>
          <span class="spacer"></span>
          <span class="chip"><span class="num">${shown}</span> of ${m.tasks.length}</span>
          <button class="btn small" data-csv>Export CSV</button>
        </div>
        <div class="tablewrap"><table class="ledger">
          <thead><tr>${REG_COLS.map(([key, label, , num]) => `
            <th class="${num ? 'num' : ''}" style="cursor:pointer" data-sort="${key}">${esc(label)}${sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${groups.map((g) => `
              ${g.label !== null ? `<tr><td colspan="${REG_COLS.length}" style="font-family:var(--mono);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim-2);padding-top:14px">// ${esc(g.label)} · ${g.tasks.length}</td></tr>` : ''}
              ${g.tasks.map((t) => `<tr class="rowlink" data-task="${esc(t.id)}" tabindex="0">
                ${REG_COLS.map(([key, , get]) => regCell(key, get(t))).join('')}
              </tr>`).join('')}`).join('')}
          </tbody>
        </table></div>
      </div>`;

    const rerender = () => ViewRegister.render(el, store);
    el.querySelector('[data-reg-q]').addEventListener('input', (e) => { st.q = e.target.value; rerender(); });
    el.querySelector('[data-reg-group]').addEventListener('change', (e) => { st.groupBy = e.target.value; rerender(); });
    el.querySelectorAll('[data-sort]').forEach((th) => th.addEventListener('click', () => {
      st.sort = st.sort[0] === th.dataset.sort ? [th.dataset.sort, st.sort[1] === 'asc' ? 'desc' : 'asc'] : [th.dataset.sort, 'asc'];
      rerender();
    }));
    el.querySelectorAll('[data-task]').forEach((tr) => {
      const open = () => {
        const t = m.taskById.get(tr.dataset.task);
        const codes = t.codes.map((c) => `${esc(c.type.name)}: ${esc(c.value.name)}`).join(' · ');
        openModal(`${t.code} — ${t.name}`, codes || 'no activity codes assigned', taskModalBody(t, m));
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
    el.querySelector('[data-csv]').addEventListener('click', () => downloadCSV(
      `activity_register_${isoDate(m.dataDate)}.csv`,
      ['activity_id', 'description', 'od_wd', 'rd_wd', 'tf_wd', 'start', 'finish', 'status', 'calendar', 'wbs',
        ...[...m.codeTypes.values()].map((ct) => ct.name.toLowerCase())],
      m.tasks.map((t) => [t.code, t.name,
        t.origDays ?? '', t.remainHrs !== undefined ? (t.remainHrs / (t.cal.dayHrs || 8)).toFixed(1) : '',
        t.floatDays !== undefined ? t.floatDays.toFixed(1) : '',
        isoDate(t.actStart ?? t.targetStart), isoDate(t.actEnd ?? t.targetEnd), t.status, t.cal.name,
        m.wbsById.get(t.wbsId)?.name || '',
        ...[...m.codeTypes.values()].map((ct) => t.codes.find((c) => c.type.id === ct.id)?.value.name || '')])));
  },
};
