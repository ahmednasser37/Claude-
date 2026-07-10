// S-Curve — period PV bars + cumulative PV line (the one brass line), with
// EV and AC as exactly one point each at the data date. A single XER file has
// no history of actuals; drawing one would be fabrication, so this view never
// does. Baseline cumulative (when loaded) renders in the slate trace color.
import { fmtDate, periodStart } from '../kernel/calendar.js';
import { computeEVM } from '../kernel/evm.js';
import { openModal } from '../ui/modal.js';
import {
  esc, fmtMoney, fmtRatio, fmtPct, mountCanvas, chartTip, a11yTable,
  ringSVG, valueOrNA, naTag,
} from '../ui/components.js';

export const ViewSCurve = {
  id: 'scurve', title: 'S-Curve', group: 'Cost & Resources',
  chip(store) {
    const e = store.d.evm;
    return `BAC <span class="num">${esc(fmtMoney(e.bac))}</span>`;
  },
  render(el, store) {
    const m = store.model;
    const evm = store.d.evm;
    const baseEvm = store.baseline ? computeEVM(store.baseline) : null;

    const ring = (label, v, fmt, color, note) => `
      <div class="ring">${ringSVG(v === null || v === undefined ? 0 : Math.min(v, 1), color)}
        <div><div class="rv">${v === null || v === undefined ? '—' : fmt(v)}</div><div class="rl">${label}</div>
        ${note ? `<div style="font-size:11px;color:var(--dim-2)">${note}</div>` : ''}</div>
      </div>`;

    el.innerHTML = `
      <div class="section">
        <h2>Cost curve</h2>
        <p class="sub">Monthly planned value with the cumulative plan line. EV and AC are single marks at the data date — the file carries one snapshot of actuals, not a history, so no actual curve is drawn.</p>
        <div class="ringrow">
          ${ring('SPI', evm.spi.value, (v) => v.toFixed(2), evm.spi.value >= 0.95 ? 'var(--good)' : evm.spi.value >= 0.85 ? 'var(--warn)' : 'var(--bad)', evm.spi.value === null ? esc(evm.spi.reason) : '')}
          ${ring('CPI', evm.cpi.value, (v) => v.toFixed(2), evm.cpi.value >= 0.95 ? 'var(--good)' : evm.cpi.value >= 0.85 ? 'var(--warn)' : 'var(--bad)', evm.cpi.value === null ? esc(evm.cpi.reason) : '')}
          ${ring('% earned', evm.earnedPct, (v) => fmtPct(v), 'var(--trace)')}
        </div>
        <div class="chartbox"><canvas></canvas></div>
        <div class="legend">
          <span><i style="background:var(--raised-2);border:1px solid var(--border);height:8px"></i>PV per month</span>
          <span><i style="background:var(--accent)"></i>cumulative PV</span>
          ${baseEvm ? '<span><i style="background:var(--trace)"></i>baseline cumulative PV</span>' : ''}
          <span><i class="dot" style="background:var(--good)"></i>EV at data date</span>
          <span><i class="dot" style="background:var(--bad)"></i>AC at data date</span>
        </div>
        ${a11yTable('Planned value by month', ['Month', 'PV', 'Cumulative PV'],
          evm.pv.map((p) => [p.key, Math.round(p.planned), Math.round(p.cum)]))}
        <p class="visually-hidden">EV at data date: ${Math.round(evm.ev)}. AC at data date: ${Math.round(evm.ac)}.</p>
      </div>

      <div class="section">
        <h2>Forecast</h2>
        <div class="statrow">
          <button class="stat" data-kpi="bac"><div class="label">BAC</div><div class="value">${esc(fmtMoney(evm.bac))}</div></button>
          <button class="stat" data-kpi="eac"><div class="label">EAC</div><div class="value ${evm.eac > evm.bac ? 'bad' : ''}">${evm.eac !== undefined ? esc(fmtMoney(evm.eac)) : ''}${evm.eac === undefined ? naTag('CPI not computable') : ''}</div></button>
          <button class="stat" data-kpi="etc"><div class="label">ETC</div><div class="value">${evm.etc !== undefined ? esc(fmtMoney(evm.etc)) : ''}${evm.etc === undefined ? naTag('CPI not computable') : ''}</div></button>
          <button class="stat" data-kpi="vac"><div class="label">VAC</div><div class="value ${evm.vac < 0 ? 'bad' : 'good'}">${evm.vac !== undefined ? esc(fmtMoney(evm.vac)) : ''}${evm.vac === undefined ? naTag('CPI not computable') : ''}</div></button>
          <button class="stat" data-kpi="tcpi"><div class="label">TCPI</div><div class="value">${evm.tcpi !== undefined ? `<span class="num">${evm.tcpi.toFixed(2)}</span>` : naTag('BAC = AC')}</div></button>
        </div>
      </div>`;

    const canvas = el.querySelector('canvas');
    const box = canvas.parentElement;
    const tip = chartTip(box);
    let geom = null;

    mountCanvas(canvas, 300, (ctx, w, h) => {
      const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
      const pad = { l: 58, r: 16, t: 12, b: 26 };
      const pv = evm.pv;
      if (!pv.length) return;
      const maxCum = Math.max(evm.bac, baseEvm ? baseEvm.bac : 0) * 1.04;
      const maxBar = Math.max(...pv.map((p) => p.planned)) * 1.15;
      const X = (i) => pad.l + (i + 0.5) * ((w - pad.l - pad.r) / pv.length);
      const bw = Math.max(((w - pad.l - pad.r) / pv.length) * 0.62, 2);
      const Y = (v) => h - pad.b - (v / maxCum) * (h - pad.t - pad.b);
      const Yb = (v) => h - pad.b - (v / maxBar) * (h - pad.t - pad.b) * 0.45;

      // grid + axis labels (money on cumulative scale)
      ctx.font = '10px ' + css('--mono');
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const v = (maxCum / 4) * i;
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = css('--border-soft');
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillStyle = css('--dim-2');
        ctx.fillText(fmtMoney(v, ''), 6, y - 3);
      }
      // month labels: every ~3rd
      pv.forEach((p, i) => {
        if (i % Math.ceil(pv.length / 8) !== 0) return;
        ctx.fillStyle = css('--dim-2');
        ctx.fillText(p.key, X(i) - 18, h - 8);
      });
      // bars (period PV) — thin marks, 2px gap comes from bar width factor
      pv.forEach((p, i) => {
        ctx.fillStyle = css('--raised-2');
        ctx.strokeStyle = css('--border');
        const x0 = X(i) - bw / 2, y0 = Yb(p.planned);
        ctx.fillRect(x0, y0, bw, h - pad.b - y0);
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, bw - 1, h - pad.b - y0 - 1);
      });
      // baseline cumulative (trace)
      if (baseEvm && baseEvm.pv.length) {
        ctx.strokeStyle = css('--trace'); ctx.lineWidth = 2; ctx.beginPath();
        baseEvm.pv.forEach((p, i) => {
          const px = pad.l + ((p.start - pv[0].start) / (periodStart(pv[pv.length - 1].key, 'month') - pv[0].start)) * (w - pad.l - pad.r - X(0) + pad.l);
          const cx = Math.min(Math.max(px, pad.l), w - pad.r);
          i === 0 ? ctx.moveTo(cx, Y(p.cum)) : ctx.lineTo(cx, Y(p.cum));
        });
        ctx.stroke();
      }
      // cumulative PV — the one brass line
      ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2; ctx.beginPath();
      pv.forEach((p, i) => (i === 0 ? ctx.moveTo(X(i), Y(p.cum)) : ctx.lineTo(X(i), Y(p.cum))));
      ctx.stroke();

      // data-date rule + EV/AC single points (with 2px surface ring)
      if (evm.evPoint) {
        const ddX = (() => {
          const first = pv[0].start, last = periodStart(pv[pv.length - 1].key, 'month');
          const f = (evm.evPoint.date - first) / (last - first);
          return pad.l + Math.min(Math.max(f, 0), 1) * (w - pad.l - pad.r);
        })();
        ctx.strokeStyle = css('--dim'); ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(ddX, pad.t); ctx.lineTo(ddX, h - pad.b); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = css('--dim');
        ctx.fillText('data date', ddX + 4, pad.t + 9);
        const pt = (v, color, label, dy) => {
          ctx.beginPath(); ctx.arc(ddX, Y(v), 6, 0, Math.PI * 2);
          ctx.fillStyle = css('--bg'); ctx.fill();
          ctx.beginPath(); ctx.arc(ddX, Y(v), 4.5, 0, Math.PI * 2);
          ctx.fillStyle = color; ctx.fill();
          ctx.fillStyle = css('--text');
          ctx.fillText(`${label} ${fmtMoney(v, '')}`, ddX + 9, Y(v) + dy);
        };
        pt(evm.ev, css('--good'), 'EV', 3);
        pt(evm.ac, css('--bad'), 'AC', evm.ac > evm.ev - maxCum * 0.05 && evm.ac < evm.ev + maxCum * 0.05 ? 14 : 3);
      }
      geom = { pad, w, h, X, count: pv.length };
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!geom) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const i = Math.min(Math.max(Math.round((mx - geom.pad.l) / ((geom.w - geom.pad.l - geom.pad.r) / geom.count) - 0.5), 0), geom.count - 1);
      const p = evm.pv[i];
      if (!p) { tip.hide(); return; }
      tip.show(`${esc(p.key)}<br>PV <b>${esc(fmtMoney(p.planned))}</b><br>cum <b>${esc(fmtMoney(p.cum))}</b>`, mx, e.clientY - rect.top);
    });
    canvas.addEventListener('mouseleave', () => tip.hide());

    const kpiModals = {
      bac: ['Budget at Completion', 'Σ assigned cost across all activities', `<kbd class="formula">BAC = Σ TASKRSRC.target_cost = ${fmtMoney(evm.bac)}</kbd>`],
      eac: ['Estimate at Completion', 'AC + (BAC − EV) ÷ CPI', `<kbd class="formula">EAC = ${fmtMoney(evm.ac)} + (${fmtMoney(evm.bac)} − ${fmtMoney(evm.ev)}) ÷ ${fmtRatio(evm.cpi.value) ?? 'N/A'} = ${evm.eac !== undefined ? fmtMoney(evm.eac) : 'N/A'}</kbd>`],
      etc: ['Estimate to Complete', 'EAC − AC', `<kbd class="formula">ETC = ${evm.eac !== undefined ? `${fmtMoney(evm.eac)} − ${fmtMoney(evm.ac)} = ${fmtMoney(evm.etc)}` : 'N/A — CPI not computable'}</kbd>`],
      vac: ['Variance at Completion', 'BAC − EAC', `<kbd class="formula">VAC = ${evm.vac !== undefined ? `${fmtMoney(evm.bac)} − ${fmtMoney(evm.eac)} = ${fmtMoney(evm.vac)}` : 'N/A — CPI not computable'}</kbd>`],
      tcpi: ['To-Complete Performance Index', '(BAC − EV) ÷ (BAC − AC)', `<kbd class="formula">TCPI = (${fmtMoney(evm.bac)} − ${fmtMoney(evm.ev)}) ÷ (${fmtMoney(evm.bac)} − ${fmtMoney(evm.ac)}) = ${evm.tcpi !== undefined ? evm.tcpi.toFixed(2) : 'N/A'}</kbd><p>Efficiency required on all remaining work to land on BAC.</p>`],
    };
    el.querySelectorAll('[data-kpi]').forEach((b) => b.addEventListener('click', () => {
      const [t, s, body] = kpiModals[b.dataset.kpi];
      openModal(t, s, body);
    }));
  },
};
