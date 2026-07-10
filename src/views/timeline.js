// Timeline — the planner's controllable window over the whole schedule.
// Pick a reporting window (presets, custom dates, ◀ ▶ stepping); the lane
// chart zooms to it and paints, per activity: the planned bar, the actual
// bar (real act_start/act_end history), late edges, and the data-date rule.
// Filters: text, status, critical-only, late-only. Every bar is clickable.
import { fmtDate, dayFloor, DAY_MS } from '../kernel/calendar.js';
import { openModal } from '../ui/modal.js';
import {
  esc, mountCanvas, chartTip, a11yTable, taskModalBody,
  windowBarHTML, wireWindowBar, downloadCSV, isoDate,
} from '../ui/components.js';

function tlCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

function tlIsLate(t, dd) {
  if (dd === undefined || t.status === 'TK_Complete') return false;
  return (t.targetEnd !== undefined && dayFloor(t.targetEnd) < dayFloor(dd))
    || (t.status === 'TK_NotStart' && t.targetStart !== undefined && dayFloor(t.targetStart) < dayFloor(dd));
}

function tlRows(store) {
  const m = store.model;
  const f = store.tlFilter;
  const { from, to } = store.win;
  const q = (f.q || '').toLowerCase();
  const rows = [];
  const walk = (node, depth) => {
    const kept = node.tasks.filter((t) => {
      if (t.targetStart === undefined || t.targetEnd === undefined) return false;
      const s = Math.min(t.targetStart, t.actStart ?? Infinity);
      // an in-progress activity is present through the data date, even when
      // its planned window is already behind us
      const e = Math.max(t.targetEnd, t.actEnd ?? 0,
        t.status === 'TK_Active' ? (m.dataDate ?? 0) : 0);
      if (dayFloor(e) < dayFloor(from) || dayFloor(s) > dayFloor(to)) return false;
      if (f.status !== 'all' && t.status !== f.status) return false;
      if (f.critical && !(t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete')) return false;
      if (f.late && !tlIsLate(t, m.dataDate)) return false;
      if (q && !(t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => a.targetStart - b.targetStart);
    if (kept.length) {
      rows.push({ header: node.name });
      for (const t of kept) rows.push({ t });
    }
    for (const c of node.children) walk(c, depth + 1);
  };
  walk(m.wbsRoot, 0);
  return rows;
}

function tlDraw(ctx, w, h, rows, store, hits) {
  hits.length = 0;
  const m = store.model;
  const { from, to } = store.win;
  const labelW = 132;
  const rowH = 20;
  const top = 22;
  const X = (ms) => labelW + ((ms - from) / Math.max(to - from, DAY_MS)) * (w - labelW - 10);
  const clampX = (x) => Math.min(Math.max(x, labelW), w - 10);

  // time grid: weekly if window <= ~10 weeks, else monthly
  ctx.font = '9px ' + tlCss('--mono');
  const weekly = (to - from) <= 76 * DAY_MS;
  let g = dayFloor(from);
  if (weekly) { while (new Date(g).getUTCDay() !== 0) g += DAY_MS; } // snap to Sunday
  else { const d = new Date(dayFloor(from)); g = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  while (g <= to) {
    const x = Math.round(X(g)) + 0.5;
    ctx.strokeStyle = 'rgba(34,48,73,.4)';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, h - 4); ctx.stroke();
    const gd = new Date(g);
    ctx.fillStyle = tlCss('--dim-2');
    ctx.fillText(weekly
      ? `${String(gd.getUTCDate()).padStart(2, '0')}/${String(gd.getUTCMonth() + 1).padStart(2, '0')}`
      : `${String(gd.getUTCMonth() + 1).padStart(2, '0')}/${String(gd.getUTCFullYear()).slice(2)}`, x + 2, 12);
    if (weekly) g += 7 * DAY_MS;
    else { const d = new Date(g); g = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  }

  rows.forEach((row, i) => {
    const y = top + i * rowH;
    if (row.header) {
      ctx.fillStyle = tlCss('--dim-2');
      ctx.font = '600 9px ' + tlCss('--mono');
      ctx.fillText(('// ' + row.header).toUpperCase().slice(0, 60), 4, y + 13);
      ctx.strokeStyle = 'rgba(34,48,73,.5)';
      ctx.beginPath(); ctx.moveTo(0, y + rowH - 2.5); ctx.lineTo(w, y + rowH - 2.5); ctx.stroke();
      return;
    }
    const t = row.t;
    const late = tlIsLate(t, m.dataDate);
    const crit = t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete';
    ctx.font = '10px ' + tlCss('--mono');
    ctx.fillStyle = late ? tlCss('--bad') : crit ? tlCss('--warn') : tlCss('--dim');
    ctx.fillText(t.code.slice(0, 14), 4, y + 13);

    const by = y + 5, bh = 9;
    // planned bar: outline
    const px0 = clampX(X(t.targetStart)), px1 = clampX(X(t.targetEnd + DAY_MS));
    if (t.milestone) {
      const cx = px0, cy = by + bh / 2;
      ctx.fillStyle = crit || late ? tlCss('--bad') : tlCss('--text');
      ctx.beginPath(); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx + 5, cy); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 5, cy); ctx.closePath(); ctx.fill();
    } else if (px1 > px0) {
      ctx.strokeStyle = crit ? tlCss('--bad') : 'rgba(139,151,173,.55)';
      ctx.setLineDash(crit ? [3, 2] : []);
      ctx.strokeRect(px0 + 0.5, by + 0.5, px1 - px0 - 1, bh - 1);
      ctx.setLineDash([]);
    }
    // actual bar: solid history from real actual dates
    if (t.actStart !== undefined) {
      const aEnd = t.actEnd !== undefined ? t.actEnd : (m.dataDate ?? t.actStart);
      const ax0 = clampX(X(t.actStart)), ax1 = clampX(X(aEnd + DAY_MS));
      if (ax1 > ax0) {
        ctx.fillStyle = t.status === 'TK_Complete' ? 'rgba(38,165,161,.9)' : tlCss('--accent');
        ctx.fillRect(ax0, by + 2, ax1 - ax0, bh - 4);
      }
    }
    // late edge marker at the planned finish
    if (late && !t.milestone && px1 > labelW) {
      ctx.fillStyle = tlCss('--bad');
      ctx.fillRect(px1 - 1.5, by - 1, 3, bh + 2);
    }
    hits.push({ t, x0: labelW, x1: w, y0: y, y1: y + rowH, bx0: Math.min(px0, X(t.actStart ?? Infinity)), bx1: Math.max(px1, 0) });
  });

  // data date
  if (m.dataDate !== undefined && m.dataDate >= from && m.dataDate <= to) {
    const x = Math.round(X(m.dataDate)) + 0.5;
    ctx.strokeStyle = tlCss('--accent'); ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(x, top - 8); ctx.lineTo(x, h - 4); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = tlCss('--accent');
    ctx.fillText('DD', x + 3, top + 2);
  }
}

export const ViewTimeline = {
  id: 'timeline', title: 'Timeline', group: 'Reporting',
  chip(store) {
    return `<span class="num">${isoDate(store.win.from)} → ${isoDate(store.win.to)}</span>`;
  },
  render(el, store) {
    const m = store.model;
    if (!store.tlFilter) store.tlFilter = { q: '', status: 'all', critical: false, late: false };
    const f = store.tlFilter;
    const rows = tlRows(store);
    const tasks = rows.filter((r) => r.t).map((r) => r.t);
    const lateCount = tasks.filter((t) => tlIsLate(t, m.dataDate)).length;

    el.innerHTML = `
      <div class="section">
        <h2>Timeline</h2>
        <p class="sub">Control the reporting window; the lanes zoom to it. Hollow bars are the plan, solid fills are recorded actuals, the red edge marks work past its planned date. Click any bar.</p>
        ${windowBarHTML(store)}
        <div class="filterrow">
          <input type="search" data-f-q placeholder="filter code / name…" value="${esc(f.q)}" aria-label="Filter activities">
          <select data-f-status aria-label="Status filter">
            <option value="all" ${f.status === 'all' ? 'selected' : ''}>All statuses</option>
            <option value="TK_Complete" ${f.status === 'TK_Complete' ? 'selected' : ''}>Complete</option>
            <option value="TK_Active" ${f.status === 'TK_Active' ? 'selected' : ''}>In progress</option>
            <option value="TK_NotStart" ${f.status === 'TK_NotStart' ? 'selected' : ''}>Not started</option>
          </select>
          <button class="winpreset ${f.critical ? 'active' : ''}" data-f-crit>Critical only</button>
          <button class="winpreset ${f.late ? 'active' : ''}" data-f-late>Late only</button>
          <span class="spacer"></span>
          <span class="chip"><span class="num">${tasks.length}</span> shown · <span class="num" style="color:${lateCount ? 'var(--bad)' : 'var(--good)'}">${lateCount}</span> late</span>
          <button class="btn small" data-csv>Export CSV</button>
        </div>
        <div class="chartbox"><canvas></canvas></div>
        <div class="legend">
          <span><i style="background:none;border:1px solid rgba(139,151,173,.55);height:8px"></i>planned</span>
          <span><i style="background:var(--accent);height:8px"></i>actual (in progress)</span>
          <span><i style="background:rgba(38,165,161,.9);height:8px"></i>actual (complete)</span>
          <span><i style="background:var(--bad);width:3px;height:10px"></i>late edge</span>
          <span><i style="background:none;border:1.5px dashed var(--bad);height:8px"></i>critical</span>
        </div>
        ${a11yTable('Timeline activities in window',
          ['Code', 'Activity', 'Planned start', 'Planned finish', 'Actual start', 'Actual finish', 'Status', 'Late'],
          tasks.map((t) => [t.code, t.name, fmtDate(t.targetStart), fmtDate(t.targetEnd),
            t.actStart !== undefined ? fmtDate(t.actStart) : 'n/a', t.actEnd !== undefined ? fmtDate(t.actEnd) : 'n/a',
            t.status, tlIsLate(t, m.dataDate) ? 'yes' : 'no']))}
      </div>`;

    wireWindowBar(el, store);
    const rerender = () => ViewTimeline.render(el, store);
    el.querySelector('[data-f-q]').addEventListener('input', (e) => { f.q = e.target.value; rerender(); });
    el.querySelector('[data-f-status]').addEventListener('change', (e) => { f.status = e.target.value; rerender(); });
    el.querySelector('[data-f-crit]').addEventListener('click', () => { f.critical = !f.critical; rerender(); });
    el.querySelector('[data-f-late]').addEventListener('click', () => { f.late = !f.late; rerender(); });
    el.querySelector('[data-csv]').addEventListener('click', () => downloadCSV(
      `timeline_${isoDate(store.win.from)}_${isoDate(store.win.to)}.csv`,
      ['code', 'name', 'wbs', 'planned_start', 'planned_finish', 'actual_start', 'actual_finish', 'status', 'float_wd', 'late'],
      tasks.map((t) => [t.code, t.name, m.wbsById.get(t.wbsId)?.name || '', isoDate(t.targetStart), isoDate(t.targetEnd),
        isoDate(t.actStart), isoDate(t.actEnd), t.status,
        t.floatDays !== undefined ? t.floatDays.toFixed(1) : '', tlIsLate(t, m.dataDate) ? 'yes' : 'no'])));

    const canvas = el.querySelector('canvas');
    const hits = [];
    const height = Math.min(Math.max(rows.length * 20 + 30, 120), 640);
    mountCanvas(canvas, height, (ctx, w, h) => tlDraw(ctx, w, h, rows, store, hits));
    const tip = chartTip(canvas.parentElement);
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const my = e.clientY - rect.top, mx = e.clientX - rect.left;
      const hit = hits.find((hh) => my >= hh.y0 && my < hh.y1 && mx >= hh.x0);
      canvas.style.cursor = hit ? 'pointer' : 'default';
      if (!hit) { tip.hide(); return; }
      const t = hit.t;
      tip.show(`<span class="num">${esc(t.code)}</span> ${esc(t.name.slice(0, 40))}<br>` +
        `plan <b>${fmtDate(t.targetStart)} → ${fmtDate(t.targetEnd)}</b>` +
        (t.actStart !== undefined ? `<br>actual <b>${fmtDate(t.actStart)} → ${t.actEnd !== undefined ? fmtDate(t.actEnd) : '…'}</b>` : ''), mx, my);
    });
    canvas.addEventListener('mouseleave', () => tip.hide());
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const my = e.clientY - rect.top, mx = e.clientX - rect.left;
      const hit = hits.find((hh) => my >= hh.y0 && my < hh.y1 && mx >= hh.x0);
      if (hit) openModal(`${hit.t.code} — ${hit.t.name}`, 'timeline detail', taskModalBody(hit.t, m));
    });
  },
};
