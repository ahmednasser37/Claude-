// Resource Histogram — weekly stacked bars by resource type; over-allocation
// only where a RSRCRATE ceiling exists, with the honest "ceiling unavailable"
// list for everything else.
import { fmtDate, periodStart } from '../kernel/calendar.js';
import { openModal } from '../ui/modal.js';
import { esc, mountCanvas, chartTip, a11yTable } from '../ui/components.js';

const RTYPE = [
  ['RT_Labor', 'Labour', '--cat-labor'],
  ['RT_Equip', 'Equipment', '--cat-equip'],
  ['RT_Mat', 'Material', '--cat-mat'],
];

export const ViewResource = {
  id: 'resource', title: 'Resource Histogram', group: 'Cost & Resources',
  chip(store) {
    return `<span class="num">${store.model.rsrcById.size}</span> resources`;
  },
  render(el, store) {
    const m = store.model;
    const d = store.d.demand;
    const keys = d.keys;
    const series = RTYPE.filter(([type]) => d.byType.has(type));

    el.innerHTML = `
      <div class="section">
        <h2>Weekly demand by resource type</h2>
        <p class="sub">Assigned quantities spread across each activity's working-day span (via its calendar), bucketed by week.</p>
        <div class="chartbox"><canvas></canvas></div>
        <div class="legend">
          ${series.map(([, label, cvar]) => `<span><i style="background:var(${cvar});height:8px"></i>${label}</span>`).join('')}
        </div>
        ${a11yTable('Weekly resource demand (quantity hours)', ['Week', ...series.map(([, l]) => l)],
          keys.map((k) => [k, ...series.map(([type]) => Math.round(d.byType.get(type).get(k) || 0))]))}
      </div>

      <div class="section">
        <h2>Over-allocation</h2>
        <p class="sub">Computable only for resources with a <span class="num">RSRCRATE.max_qty_per_hr</span> ceiling. Flagged where a week's average demand clearly exceeds it (&gt;5% over).</p>
        ${d.overalloc.length === 0 ? '<div class="empty"><h3>No breaches</h3><p>No ceilinged resource exceeds its limit in any week.</p></div>'
        : `<div class="tablewrap"><table class="ledger">
            <thead><tr><th>Resource</th><th class="num">Week of</th><th class="num">Avg demand /hr</th><th class="num">Ceiling /hr</th><th class="num">Load</th></tr></thead>
            <tbody>${d.overalloc.map((o, i) => `<tr class="rowlink" data-oa="${i}" tabindex="0">
              <td>${esc(o.rsrc.name)}</td>
              <td class="num">${fmtDate(o.start)}</td>
              <td class="num">${o.avgPerHr.toFixed(2)}</td>
              <td class="num">${o.maxPerHr}</td>
              <td class="num" style="color:${o.ratio > 1.5 ? 'var(--bad)' : 'var(--warn)'}">${Math.round(o.ratio * 100)}%</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
        ${d.noCeiling.length ? `<p class="sub" style="margin-top:12px">Ceiling unavailable (no RSRCRATE row) — over-allocation <b>not computable</b>, not assumed fine: ${d.noCeiling.map((r) => `<span class="num">${esc(r.name)}</span>`).join(', ')}.</p>` : ''}
      </div>`;

    const canvas = el.querySelector('canvas');
    const tip = chartTip(canvas.parentElement);
    let geom = null;

    mountCanvas(canvas, 280, (ctx, w, h) => {
      const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
      const pad = { l: 46, r: 10, t: 12, b: 26 };
      if (!keys.length) return;
      const totals = keys.map((k) => series.reduce((a, [type]) => a + (d.byType.get(type).get(k) || 0), 0));
      const maxV = Math.max(...totals) * 1.1 || 1;
      const step = (w - pad.l - pad.r) / keys.length;
      const bw = Math.max(step - 2, 1); // 2px surface gap between adjacent bars
      const Y = (v) => h - pad.b - (v / maxV) * (h - pad.t - pad.b);

      ctx.font = '10px ' + css('--mono');
      for (let i = 0; i <= 4; i++) {
        const v = (maxV / 4) * i;
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = css('--border-soft');
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillStyle = css('--dim-2');
        ctx.fillText(String(Math.round(v)), 6, y - 3);
      }
      keys.forEach((k, i) => {
        let y0 = h - pad.b;
        for (const [type, , cvar] of series) {
          const v = d.byType.get(type).get(k) || 0;
          if (v <= 0) continue;
          const hh = (v / maxV) * (h - pad.t - pad.b);
          ctx.fillStyle = css(cvar);
          ctx.fillRect(pad.l + i * step + 1, y0 - hh, bw, Math.max(hh - 2, 1)); // 2px gap between stack segments
          y0 -= hh;
        }
        if (i % Math.ceil(keys.length / 9) === 0) {
          ctx.fillStyle = css('--dim-2');
          ctx.fillText(k.slice(2), pad.l + i * step, h - 8);
        }
      });
      geom = { pad, step };
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!geom) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const i = Math.floor((mx - geom.pad.l) / geom.step);
      const k = keys[i];
      if (!k) { tip.hide(); return; }
      tip.show(`week of ${esc(fmtDate(periodStart(k, 'week')))}<br>${series.map(([type, label]) =>
        `${label} <b>${Math.round(d.byType.get(type).get(k) || 0)}</b>`).join('<br>')}`, mx, e.clientY - rect.top);
    });
    canvas.addEventListener('mouseleave', () => tip.hide());

    el.querySelectorAll('[data-oa]').forEach((tr) => {
      const open = () => {
        const o = d.overalloc[+tr.dataset.oa];
        const users = m.assignments
          .filter((a) => a.rsrcId === o.rsrc.id)
          .map((a) => m.taskById.get(a.taskId))
          .filter((t) => t && t.targetStart !== undefined && t.targetEnd !== undefined
            && t.targetStart <= o.start + 7 * 86400000 && t.targetEnd >= o.start);
        openModal(`${o.rsrc.name} — week of ${fmtDate(o.start)}`, 'over-allocation detail', `
          <dl>
            <dt>Avg demand</dt><dd class="num">${o.avgPerHr.toFixed(2)} /hr</dd>
            <dt>Ceiling</dt><dd class="num">${o.maxPerHr} /hr (RSRCRATE.max_qty_per_hr)</dd>
            <dt>Load</dt><dd class="num">${Math.round(o.ratio * 100)}%</dd>
          </dl>
          <h4 style="margin:10px 0 4px;font-size:12px;color:var(--dim-2);text-transform:uppercase;letter-spacing:.08em">Activities drawing on it that week</h4>
          <ul class="offender-list">${users.map((t) => `<li>${esc(t.code)} ${esc(t.name.slice(0, 40))}</li>`).join('') || '<li>—</li>'}</ul>
          <p style="margin-top:10px"><b>Suggested review:</b> stagger the overlapping activities or add a second ${esc(o.rsrc.name)} spread — the schedule logic currently books both at once.</p>`);
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  },
};
