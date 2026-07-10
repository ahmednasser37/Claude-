// Update History — trending across successive XER updates. Each point is one
// snapshot's own recorded state at its own data date: the slip chart, a REAL
// EV/AC history (the thing a single file can never give), index trends,
// float-erosion ranking, and window-by-window attribution of what ate the
// schedule between updates.
import { fmtDate, DAY_MS } from '../kernel/calendar.js';
import { openModal } from '../ui/modal.js';
import {
  esc, fmtMoney, mountCanvas, chartTip, a11yTable, taskModalBody,
  downloadCSV, isoDate, statTile,
} from '../ui/components.js';

const TREND_COLORS = ['#3f83c9', '#bd7f33', '#9068d8']; // validated trio on this surface

function trCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

// generic small multi-series trend chart: x = data date, markers + direct labels
function drawTrend(ctx, w, h, series, { yFmt = (v) => String(v), refY = null, yDate = false } = {}) {
  const pad = { l: yDate ? 82 : 64, r: 86, t: 12, b: 22 };
  const xs = series.flatMap((s) => s.pts.map((p) => p.x));
  const ys = series.flatMap((s) => s.pts.map((p) => p.y)).concat(refY !== null ? [refY] : []);
  if (!xs.length) return;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = y1 - y0 || 1;
  y0 -= span * 0.12; y1 += span * 0.12;
  const X = (v) => pad.l + (x1 > x0 ? (v - x0) / (x1 - x0) : 0.5) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - ((v - y0) / (y1 - y0)) * (h - pad.t - pad.b);

  ctx.font = '9px ' + trCss('--mono');
  for (let i = 0; i <= 3; i++) {
    const v = y0 + ((y1 - y0) / 3) * i;
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = 'rgba(34,48,73,.4)';
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = trCss('--dim-2');
    ctx.fillText(yDate ? fmtDate(v) : yFmt(v), 4, y - 3);
  }
  for (const x of xs) {
    ctx.fillStyle = trCss('--dim-2');
    ctx.fillText(fmtDate(x).slice(3), X(x) - 22, h - 7);
  }
  if (refY !== null) {
    ctx.strokeStyle = trCss('--dim-2'); ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, Y(refY)); ctx.lineTo(w - pad.r, Y(refY)); ctx.stroke();
    ctx.setLineDash([]);
  }
  series.forEach((s) => {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    s.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
    ctx.stroke();
    for (const p of s.pts) {
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 5.5, 0, Math.PI * 2);
      ctx.fillStyle = trCss('--bg'); ctx.fill(); // 2px surface ring
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2);
      ctx.fillStyle = s.color; ctx.fill();
    }
    const last = s.pts[s.pts.length - 1];
    ctx.fillStyle = trCss('--text');
    ctx.fillText(s.label, X(last.x) + 9, Y(last.y) + 3);
  });
}

function sparkSVG(vals, w = 90, h = 22) {
  const known = vals.map((v, i) => [i, v]).filter(([, v]) => v !== undefined);
  if (known.length < 2) return '';
  const ys = known.map(([, v]) => v);
  const y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 0);
  const px = (i) => 4 + (i / (vals.length - 1)) * (w - 8);
  const py = (v) => h - 4 - ((v - y0) / (y1 - y0 || 1)) * (h - 8);
  const pathPts = known.map(([i, v]) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const zero = y0 <= 0 && y1 >= 0 ? `<line x1="4" y1="${py(0).toFixed(1)}" x2="${w - 4}" y2="${py(0).toFixed(1)}" stroke="rgba(139,151,173,.35)" stroke-dasharray="2 3"/>` : '';
  const lastV = known[known.length - 1][1];
  return `<svg width="${w}" height="${h}" aria-hidden="true">${zero}
    <polyline points="${pathPts}" fill="none" stroke="${lastV < 0 ? 'var(--bad)' : 'var(--chart-line)'}" stroke-width="1.5"/>
    <circle cx="${px(known[known.length - 1][0]).toFixed(1)}" cy="${py(lastV).toFixed(1)}" r="2.5" fill="${lastV < 0 ? 'var(--bad)' : 'var(--chart-line)'}"/>
  </svg>`;
}

export const ViewTrend = {
  id: 'trend', title: 'Update History', group: 'Compare',
  chip(store) {
    const t = store.d.trend;
    return t && t.ok ? `<span class="num">${t.points.length}</span> updates` : '';
  },
  render(el, store) {
    const t = store.d.trend;
    if (!t || !t.ok) {
      el.innerHTML = `
        <div class="empty">
          <h3>Update history</h3>
          <p>${t ? esc(t.reason) : 'Load two or more successive .xer updates of the same project.'}
          Each snapshot contributes exactly one recorded point — this is the only honest source of EV/AC history, slip trending and float erosion.</p>
          <p style="margin-top:14px">
            <button class="btn" data-load-history>Load updates… (multi-select)</button>
            <button class="btn primary" data-demo-history>Load demo history</button>
          </p>
        </div>`;
      el.querySelector('[data-demo-history]').addEventListener('click', () => store.useDemoHistory());
      el.querySelector('[data-load-history]').addEventListener('click', () => store.pickUpdateFiles());
      return;
    }

    const pts = t.points;
    const last = pts[pts.length - 1];
    const first = pts[0];
    const totalSlip = t.windows.reduce((a, w) => a + (w.finishSlipWd ?? 0), 0);

    el.innerHTML = `
      <div class="section">
        <h2>Update history</h2>
        <p class="sub">${pts.length} updates, ${fmtDate(first.dd)} → ${fmtDate(last.dd)}. Every point is one snapshot's own recorded state — no interpolation, no extrapolation.</p>
        <div class="filterrow">
          <button class="btn small" data-load-history>Add updates…</button>
          <span class="spacer"></span>
          <button class="btn small" data-csv>Export CSV</button>
        </div>
        <div class="statrow">
          ${statTile({ id: 'slip', label: 'Finish slip', value: `<span class="num">${totalSlip >= 0 ? '+' : ''}${totalSlip} wd</span>`, tone: totalSlip > 0 ? 'bad' : 'good', note: `${fmtDate(first.finish)} → ${fmtDate(last.finish)}` })}
          ${statTile({ id: 'ev', label: 'EV accrued', value: `<span class="num" style="font-size:19px">${esc(fmtMoney(last.ev - first.ev))}</span>`, note: 'across loaded history' })}
          ${statTile({ id: 'ac', label: 'AC accrued', value: `<span class="num" style="font-size:19px">${esc(fmtMoney(last.ac - first.ac))}</span>`, tone: (last.ac - first.ac) > (last.ev - first.ev) ? 'warn' : 'good', note: 'across loaded history' })}
          ${statTile({ id: 'neg', label: 'Negative float', value: `<span class="num">${pts.map((p) => p.negFloat).join(' → ')}</span>`, tone: last.negFloat > first.negFloat ? 'bad' : 'good', note: 'per update' })}
        </div>
      </div>

      <div class="section">
        <h2>Forecast finish — the slip chart</h2>
        <p class="sub">Project finish as forecast at each data date. Flat means the plan is holding; the slope IS the rate of slip.</p>
        <div class="chartbox"><canvas data-chart="slip"></canvas></div>
        ${a11yTable('Forecast finish by update', ['Data date', 'Forecast finish'],
          pts.map((p) => [isoDate(p.dd), isoDate(p.finish)]))}
      </div>

      <div class="section">
        <h2>Earned / actual / planned — real history</h2>
        <p class="sub">Recorded EV, AC and PV-at-data-date from each snapshot. The AC line pulling above EV is cost overrun; both trailing PV is schedule slip.</p>
        <div class="chartbox"><canvas data-chart="evac"></canvas></div>
        <div class="legend">
          <span><i style="background:${TREND_COLORS[0]}"></i>PV at DD</span>
          <span><i style="background:${TREND_COLORS[1]}"></i>AC</span>
          <span><i style="background:${TREND_COLORS[2]}"></i>EV</span>
        </div>
        ${a11yTable('EVM history by update', ['Data date', 'PV at DD', 'EV', 'AC'],
          pts.map((p) => [isoDate(p.dd), Math.round(p.pvAtDD ?? 0), Math.round(p.ev), Math.round(p.ac)]))}
      </div>

      <div class="section">
        <h2>Performance indices</h2>
        <div class="chartbox"><canvas data-chart="idx"></canvas></div>
        <div class="legend">
          <span><i style="background:${TREND_COLORS[0]}"></i>SPI</span>
          <span><i style="background:${TREND_COLORS[1]}"></i>CPI</span>
          <span><i style="background:${TREND_COLORS[2]}"></i>SPI(t)</span>
        </div>
        ${a11yTable('Indices by update', ['Data date', 'SPI', 'CPI', 'SPI(t)'],
          pts.map((p) => [isoDate(p.dd), p.spi?.toFixed(2) ?? 'n/a', p.cpi?.toFixed(2) ?? 'n/a', p.spit?.toFixed(2) ?? 'n/a']))}
      </div>

      <div class="section">
        <h2>What ate the schedule — window attribution</h2>
        ${t.windows.map((w, wi) => `
          <div class="card" style="margin-bottom:10px">
            <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline">
              <b class="num">${fmtDate(w.from.dd)} → ${fmtDate(w.to.dd)}</b>
              <span class="num" style="color:${(w.finishSlipWd ?? 0) > 0 ? 'var(--bad)' : 'var(--good)'}">finish ${w.finishSlipWd !== undefined ? (w.finishSlipWd >= 0 ? '+' : '') + w.finishSlipWd + ' wd' : 'n/a'}</span>
              <span style="color:var(--dim)">EV +${fmtMoney(w.evAccrued)} · AC +${fmtMoney(w.acAccrued)} · ${w.completedInWindow} completed</span>
            </div>
            ${w.newlyCritical.length ? `<div style="margin-top:8px;font-size:12.5px"><span style="color:var(--bad)">newly critical:</span> ${w.newlyCritical.map((task) => `<button class="num" data-trend-task="${wi}:${esc(task.code)}" style="color:var(--text);text-decoration:underline dotted var(--dim-2);margin-right:8px">${esc(task.code)}</button>`).join('')}</div>` : ''}
            ${w.recovered.length ? `<div style="margin-top:4px;font-size:12.5px"><span style="color:var(--good)">left critical:</span> <span class="num" style="color:var(--dim)">${w.recovered.map((task) => esc(task.code)).join(', ')}</span></div>` : ''}
          </div>`).join('')}
      </div>

      <div class="section">
        <h2>Float erosion</h2>
        <p class="sub">Total float per update, most-consumed first — erosion is the earliest stress signal, visible before finish dates move. Blank cells mean that update carries no float for the activity (not zero).</p>
        <div class="tablewrap"><table class="ledger">
          <thead><tr><th>Activity</th>${pts.map((p) => `<th class="num">${esc(isoDate(p.dd).slice(2))}</th>`).join('')}<th class="num">Δ wd</th><th>Trend</th></tr></thead>
          <tbody>${t.floatErosion.slice(0, 14).map((f, i) => `
            <tr class="rowlink" data-erosion="${i}" tabindex="0">
              <td><span class="num">${esc(f.code)}</span> ${esc(f.name.slice(0, 34))}</td>
              ${f.vals.map((v) => `<td class="num" style="${v !== undefined && v < 0 ? 'color:var(--bad)' : ''}">${v !== undefined ? v.toFixed(1) : ''}</td>`).join('')}
              <td class="num" style="color:${f.delta < 0 ? 'var(--bad)' : 'var(--dim)'}">${f.delta > 0 ? '+' : ''}${f.delta}</td>
              <td>${sparkSVG(f.vals)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;

    el.querySelector('[data-load-history]').addEventListener('click', () => store.pickUpdateFiles());
    el.querySelector('[data-csv]').addEventListener('click', () => downloadCSV(
      `update_history_${isoDate(last.dd)}.csv`,
      ['data_date', 'forecast_finish', 'pv_at_dd', 'ev', 'ac', 'spi', 'cpi', 'spi_t', 'negative_float', 'completed', 'dcma_pass'],
      pts.map((p) => [isoDate(p.dd), isoDate(p.finish), Math.round(p.pvAtDD ?? 0), Math.round(p.ev), Math.round(p.ac),
        p.spi?.toFixed(3) ?? '', p.cpi?.toFixed(3) ?? '', p.spit?.toFixed(3) ?? '', p.negFloat, p.done, `${p.dcmaPass}/${p.dcmaComputable}`])));

    const money = (v) => fmtMoney(v, '');
    mountCanvas(el.querySelector('[data-chart="slip"]'), 220, (ctx, w, h) =>
      drawTrend(ctx, w, h,
        [{ label: 'finish', color: trCss('--chart-line'), pts: pts.map((p) => ({ x: p.dd, y: p.finish })) }],
        { yDate: true, refY: first.finish }));
    mountCanvas(el.querySelector('[data-chart="evac"]'), 240, (ctx, w, h) =>
      drawTrend(ctx, w, h, [
        { label: 'PV', color: TREND_COLORS[0], pts: pts.map((p) => ({ x: p.dd, y: p.pvAtDD ?? 0 })) },
        { label: 'AC', color: TREND_COLORS[1], pts: pts.map((p) => ({ x: p.dd, y: p.ac })) },
        { label: 'EV', color: TREND_COLORS[2], pts: pts.map((p) => ({ x: p.dd, y: p.ev })) },
      ], { yFmt: money }));
    mountCanvas(el.querySelector('[data-chart="idx"]'), 200, (ctx, w, h) =>
      drawTrend(ctx, w, h, [
        { label: 'SPI', color: TREND_COLORS[0], pts: pts.filter((p) => p.spi !== null).map((p) => ({ x: p.dd, y: p.spi })) },
        { label: 'CPI', color: TREND_COLORS[1], pts: pts.filter((p) => p.cpi !== null).map((p) => ({ x: p.dd, y: p.cpi })) },
        { label: 'SPI(t)', color: TREND_COLORS[2], pts: pts.filter((p) => p.spit !== null).map((p) => ({ x: p.dd, y: p.spit })) },
      ], { yFmt: (v) => v.toFixed(2), refY: 1 }));

    el.querySelectorAll('[data-trend-task]').forEach((b) => b.addEventListener('click', () => {
      const [wi, code] = b.dataset.trendTask.split(':');
      const w = t.windows[+wi];
      const task = w.to.model.taskByCode.get(code);
      if (task) openModal(`${task.code} — ${task.name}`, `newly critical in ${fmtDate(w.from.dd)} → ${fmtDate(w.to.dd)}`, taskModalBody(task, w.to.model));
    }));
    el.querySelectorAll('[data-erosion]').forEach((tr) => {
      const open = () => {
        const f = t.floatErosion[+tr.dataset.erosion];
        const task = last.model.taskByCode.get(f.code);
        openModal(`${f.code} — float erosion`, `${f.delta} wd across the loaded history`, `
          <dl>${pts.map((p, i) => `<dt>${fmtDate(p.dd)}</dt><dd class="num">${f.vals[i] !== undefined ? f.vals[i].toFixed(1) + ' wd' : '<span class="na-tag">no float in this update</span>'}</dd>`).join('')}</dl>
          ${task ? taskModalBody(task, last.model) : ''}`);
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  },
};
