// Lookahead — the 2/4/6-week forward brief: what starts, what finishes,
// which constraints fall due, and which planned starts are NOT actually
// released because predecessors are incomplete (the readiness check that
// separates a lookahead from a wish list).
import { fmtDate, DAY_MS, dayFloor } from '../kernel/calendar.js';
import { openModal } from '../ui/modal.js';
import { esc, statTile, taskModalBody, downloadCSV, isoDate, naTag } from '../ui/components.js';

const LA_HORIZONS = [[14, '2 weeks'], [28, '4 weeks'], [42, '6 weeks']];

export const ViewLookahead = {
  id: 'lookahead', title: 'Lookahead', group: 'Reporting',
  horizon: 28,
  chip(store) {
    return `next <span class="num">${ViewLookahead.horizon / 7}</span> wk`;
  },
  render(el, store) {
    const m = store.model;
    if (m.dataDate === undefined) {
      el.innerHTML = `<div class="empty"><h3>No data date</h3><p>${naTag('file has neither last_schedule_date nor last_recalc_date — a lookahead needs a "now"')}</p></div>`;
      return;
    }
    const from = dayFloor(m.dataDate) + DAY_MS;
    const to = dayFloor(m.dataDate) + ViewLookahead.horizon * DAY_MS;
    const la = store.getLookahead(from, to);
    const blockedIds = new Set(la.blockedStarts.map((b) => b.t.id));

    const taskRows = (items, dateOf, extra) => items.map((t, i) => `
      <tr class="rowlink" data-la="${extra}:${i}" tabindex="0">
        <td class="num">${esc(t.code)}</td><td>${esc(t.name)}</td>
        <td class="num">${fmtDate(dateOf(t))}</td>
        <td>${t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 ? '<span class="pill fail">critical</span>' : t.floatDays !== undefined && t.floatDays <= 5 ? '<span class="pill warn">near-crit</span>' : ''}
        ${extra === 'start' && blockedIds.has(t.id) ? '<span class="pill warn">blocked</span>' : ''}</td>
      </tr>`).join('');

    el.innerHTML = `
      <div class="section">
        <h2>Lookahead</h2>
        <p class="sub">The forward brief from the data date (${fmtDate(m.dataDate)}). "Blocked" starts have incomplete predecessors — scheduled is not the same as released.</p>
        <div class="winbar"><div class="winpresets">
          ${LA_HORIZONS.map(([d, label]) => `<button class="winpreset ${ViewLookahead.horizon === d ? 'active' : ''}" data-hz="${d}">${label}</button>`).join('')}
        </div>
        <div class="winrange"><span class="chip"><span class="num">${isoDate(from)} → ${isoDate(to)}</span></span>
        <button class="btn small" data-csv>Export CSV</button></div></div>
        <div class="statrow" style="margin-top:14px">
          ${statTile({ id: 'st', label: 'Starting', value: `<span class="num">${la.starting.length}</span>`, note: 'planned starts in horizon' })}
          ${statTile({ id: 'fi', label: 'Finishing', value: `<span class="num">${la.finishing.length}</span>`, note: 'planned finishes in horizon' })}
          ${statTile({ id: 'bl', label: 'Blocked starts', value: `<span class="num">${la.blockedStarts.length}</span>`, tone: la.blockedStarts.length ? 'warn' : 'good', note: 'predecessors incomplete' })}
          ${statTile({ id: 'cn', label: 'Constraints due', value: `<span class="num">${la.constraintsDue.length}</span>`, tone: la.constraintsDue.length ? 'warn' : 'good', note: 'cstr_date in horizon' })}
        </div>
      </div>

      <div class="section">
        <h2>Blocked starts <span class="num" style="color:${la.blockedStarts.length ? 'var(--warn)' : 'var(--good)'}">${la.blockedStarts.length}</span></h2>
        <p class="sub">Planned to start in the horizon while a Finish-to-Start predecessor is unfinished (or a Start-to-Start predecessor unstarted). Chase these first.</p>
        ${la.blockedStarts.length ? `<div class="tablewrap"><table class="ledger">
          <thead><tr><th>Activity</th><th class="num">Planned start</th><th>Waiting on</th></tr></thead>
          <tbody>${la.blockedStarts.map((b, i) => `<tr class="rowlink" data-la="blocked:${i}" tabindex="0">
            <td><span class="num">${esc(b.t.code)}</span> ${esc(b.t.name)}</td>
            <td class="num">${fmtDate(b.t.targetStart)}</td>
            <td class="num">${b.blockers.map((x) => esc(x.pred.code) + (x.pred.status === 'TK_Active' ? ' (in progress)' : ' (not started)')).join(', ')}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="sub">Every planned start in the horizon is logically released.</p>'}
      </div>

      <div class="section">
        <h2>Starting <span class="num">${la.starting.length}</span></h2>
        ${la.starting.length ? `<div class="tablewrap"><table class="ledger">
          <thead><tr><th>Code</th><th>Activity</th><th class="num">Planned start</th><th>Flags</th></tr></thead>
          <tbody>${taskRows(la.starting, (t) => t.targetStart, 'start')}</tbody></table></div>`
        : '<p class="sub">No planned starts in this horizon.</p>'}
      </div>

      <div class="section">
        <h2>Finishing <span class="num">${la.finishing.length}</span></h2>
        ${la.finishing.length ? `<div class="tablewrap"><table class="ledger">
          <thead><tr><th>Code</th><th>Activity</th><th class="num">Planned finish</th><th>Flags</th></tr></thead>
          <tbody>${taskRows(la.finishing, (t) => t.targetEnd, 'finish')}</tbody></table></div>`
        : '<p class="sub">No planned finishes in this horizon.</p>'}
      </div>

      <div class="section">
        <h2>Constraints due <span class="num">${la.constraintsDue.length}</span></h2>
        ${la.constraintsDue.length ? `<div class="tablewrap"><table class="ledger">
          <thead><tr><th>Code</th><th>Activity</th><th class="num">Constraint</th><th class="num">Date</th></tr></thead>
          <tbody>${la.constraintsDue.map((t, i) => `<tr class="rowlink" data-la="cstr:${i}" tabindex="0">
            <td class="num">${esc(t.code)}</td><td>${esc(t.name)}</td>
            <td class="num">${esc(t.cstrType)}</td><td class="num">${fmtDate(t.cstrDate)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="sub">No constraint dates fall in this horizon.</p>'}
      </div>`;

    el.querySelectorAll('[data-hz]').forEach((b) => b.addEventListener('click', () => {
      ViewLookahead.horizon = +b.dataset.hz;
      ViewLookahead.render(el, store);
    }));

    const lists = { start: la.starting, finish: la.finishing, cstr: la.constraintsDue, blocked: la.blockedStarts.map((b) => b.t) };
    el.querySelectorAll('[data-la]').forEach((tr) => {
      const open = () => {
        const [k, i] = tr.dataset.la.split(':');
        const t = lists[k][+i];
        if (t) openModal(`${t.code} — ${t.name}`, 'lookahead detail', taskModalBody(t, m));
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });

    el.querySelector('[data-csv]').addEventListener('click', () => {
      const rows = [];
      for (const t of la.starting) rows.push(['starting', t.code, t.name, isoDate(t.targetStart), blockedIds.has(t.id) ? 'blocked' : '']);
      for (const t of la.finishing) rows.push(['finishing', t.code, t.name, isoDate(t.targetEnd), '']);
      for (const t of la.constraintsDue) rows.push(['constraint_due', t.code, t.name, isoDate(t.cstrDate), t.cstrType]);
      downloadCSV(`lookahead_${ViewLookahead.horizon}d_${isoDate(from)}.csv`,
        ['category', 'code', 'name', 'date', 'flag'], rows);
    });
  },
};
