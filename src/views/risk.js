// Risk — Monte Carlo schedule risk analysis. Every number on this page comes
// from thousands of real CPM passes over the actual network; the seed is
// shown so any run can be reproduced exactly.
import { fmtDate } from '../kernel/calendar.js';
import { runMonteCarlo, MC_SPREADS } from '../kernel/montecarlo.js';
import { openModal } from '../ui/modal.js';
import {
  esc, mountCanvas, chartTip, a11yTable, taskModalBody, statTile,
  downloadCSV, isoDate,
} from '../ui/components.js';

function riskCss(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

export const ViewRisk = {
  id: 'risk', title: 'Risk (Monte Carlo)', group: 'Schedule',
  cfg: { iterations: 1000, spreadKey: 'moderate', seed: 20260710 },
  result: null,
  chip() {
    return ViewRisk.result?.ok ? `P80 <span class="num">${fmtDate(ViewRisk.result.p80.date)}</span>` : '';
  },
  render(el, store) {
    const cfg = ViewRisk.cfg;
    if (!ViewRisk.result || ViewRisk.resultModel !== store.model) {
      ViewRisk.result = runMonteCarlo(store.model, {
        iterations: cfg.iterations, spread: MC_SPREADS[cfg.spreadKey], seed: cfg.seed,
      });
      ViewRisk.resultModel = store.model;
    }
    const mc = ViewRisk.result;

    const controls = `
      <div class="filterrow">
        <select data-mc-iter aria-label="Iterations">
          ${[500, 1000, 2000, 5000].map((n) => `<option value="${n}" ${cfg.iterations === n ? 'selected' : ''}>${n} iterations</option>`).join('')}
        </select>
        <select data-mc-spread aria-label="Duration uncertainty">
          ${Object.entries(MC_SPREADS).map(([k, s]) => `<option value="${k}" ${cfg.spreadKey === k ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <input type="number" data-mc-seed value="${cfg.seed}" aria-label="Seed" style="width:120px;font-family:var(--mono);font-size:12px;background:var(--raised);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:5px 9px">
        <button class="btn small primary" data-mc-run>Re-run</button>
        <span class="spacer"></span>
        ${mc.ok ? '<button class="btn small" data-csv>Export CSV</button>' : ''}
      </div>`;

    if (!mc.ok) {
      el.innerHTML = `<div class="section"><h2>Schedule risk</h2>${controls}
        <div class="empty"><h3>Simulation not possible</h3><p>${esc(mc.reason)}</p></div></div>`;
      ViewRisk.wireControls(el, store);
      return;
    }

    el.innerHTML = `
      <div class="section">
        <h2>Schedule risk — Monte Carlo</h2>
        <p class="sub">${mc.iterations} full CPM passes over the live network, triangular duration uncertainty on ${mc.uncertainCount} incomplete activities (completed work is history and stays fixed). Logic-integrity model, working-day units. Seed <span class="num">${mc.seed}</span> — every run reproducible.</p>
        ${controls}
        <div class="statrow">
          ${statTile({ id: 'det', label: 'Deterministic', value: `<span class="num" style="font-size:19px">${fmtDate(mc.deterministicDate)}</span>`, note: `only ${(mc.pDeterministic * 100).toFixed(0)}% likely to be met` , tone: mc.pDeterministic < 0.5 ? 'warn' : 'good' })}
          ${statTile({ id: 'p50', label: 'P50', value: `<span class="num" style="font-size:19px">${fmtDate(mc.p50.date)}</span>`, note: 'even odds' })}
          ${statTile({ id: 'p80', label: 'P80', value: `<span class="num" style="font-size:19px">${fmtDate(mc.p80.date)}</span>`, note: 'commitment-grade', tone: 'warn' })}
          ${mc.constraint ? statTile({ id: 'cstr', label: 'Mandatory finish', value: `<span class="num" style="font-size:19px">${(mc.constraint.pMeet * 100).toFixed(0)}%</span>`, note: `chance of meeting ${fmtDate(mc.constraint.date)}`, tone: mc.constraint.pMeet < 0.5 ? 'bad' : mc.constraint.pMeet < 0.8 ? 'warn' : 'good' }) : ''}
        </div>
      </div>

      <div class="section">
        <h2>Finish distribution</h2>
        <p class="sub">Histogram of simulated finishes with the cumulative probability curve beneath — read any target date's confidence off the lower chart.</p>
        <div class="chartbox"><canvas data-mc="hist"></canvas></div>
        <div class="chartbox" style="margin-top:2px"><canvas data-mc="cum"></canvas></div>
        <div class="legend">
          <span><i style="background:var(--raised-2);border:1px solid var(--border);height:8px"></i>iterations per bin</span>
          <span><i style="background:var(--chart-line)"></i>cumulative probability</span>
          <span><i style="background:var(--warn);width:2px;height:10px"></i>P50 / P80</span>
          ${mc.constraint ? '<span><i style="background:var(--bad);width:2px;height:10px"></i>mandatory finish</span>' : ''}
        </div>
        ${a11yTable('Finish distribution', ['Bin from', 'Bin to', 'Iterations'],
          mc.bins.map((b) => [isoDate(mc.toDate(b.fromDays)), isoDate(mc.toDate(b.toDays)), b.count]))}
      </div>

      <div class="section">
        <h2>Criticality index</h2>
        <p class="sub">How often each activity landed on the critical path across all iterations — near-critical work that a float filter hides shows up here.</p>
        <div class="tablewrap"><table class="ledger"><tbody>
          ${mc.criticality.slice(0, 14).map((c, i) => `
            <tr class="rowlink" data-crit="${i}" tabindex="0">
              <td class="num" style="width:96px">${esc(c.t.code)}</td>
              <td>${esc(c.t.name.slice(0, 44))}</td>
              <td style="width:34%"><span class="bar" style="display:block"><i style="width:${(c.index * 100).toFixed(0)}%;background:${c.index > 0.8 ? 'var(--bad)' : c.index > 0.4 ? 'var(--warn)' : 'var(--chart-line)'}"></i></span></td>
              <td class="num" style="width:56px">${(c.index * 100).toFixed(0)}%</td>
            </tr>`).join('')}
        </tbody></table></div>
      </div>

      <div class="section">
        <h2>Duration sensitivity — tornado</h2>
        <p class="sub">Correlation between each activity's sampled duration and the project finish. Long bars are where risk mitigation actually buys schedule.</p>
        <div class="tablewrap"><table class="ledger"><tbody>
          ${mc.sensitivity.slice(0, 12).map((s, i) => `
            <tr class="rowlink" data-sens="${i}" tabindex="0">
              <td class="num" style="width:96px">${esc(s.t.code)}</td>
              <td>${esc(s.t.name.slice(0, 44))}</td>
              <td style="width:34%"><span class="bar" style="display:block"><i style="width:${Math.min(Math.abs(s.r) * 100, 100).toFixed(0)}%;background:${Math.abs(s.r) > 0.5 ? 'var(--bad)' : 'var(--trace)'}"></i></span></td>
              <td class="num" style="width:56px">${s.r.toFixed(2)}</td>
            </tr>`).join('')}
        </tbody></table></div>
      </div>`;

    ViewRisk.wireControls(el, store);

    // histogram
    mountCanvas(el.querySelector('[data-mc="hist"]'), 200, (ctx, w, h) => {
      const pad = { l: 46, r: 14, t: 10, b: 6 };
      const maxC = Math.max(...mc.bins.map((b) => b.count));
      const X = (days) => pad.l + ((days - mc.minDays) / (mc.maxDays - mc.minDays || 1)) * (w - pad.l - pad.r);
      const bw = (w - pad.l - pad.r) / mc.bins.length;
      ctx.font = '9px ' + riskCss('--mono');
      mc.bins.forEach((b, k) => {
        const bh = (b.count / maxC) * (h - pad.t - pad.b);
        ctx.fillStyle = riskCss('--raised-2');
        ctx.strokeStyle = riskCss('--border');
        ctx.fillRect(pad.l + k * bw + 1, h - pad.b - bh, bw - 2, bh);
        ctx.strokeRect(pad.l + k * bw + 1.5, h - pad.b - bh + 0.5, bw - 3, bh - 1);
      });
      const rule = (days, color, label) => {
        const x = Math.round(X(days)) + 0.5;
        ctx.strokeStyle = color; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.fillText(label, x + 3, pad.t + 8);
      };
      rule(mc.p50.days, riskCss('--warn'), 'P50');
      rule(mc.p80.days, riskCss('--warn'), 'P80');
      rule(mc.deterministicDays, riskCss('--dim'), 'DET');
      if (mc.constraint) rule(mc.constraint.days, riskCss('--bad'), 'MAND');
    });

    // cumulative probability
    const cumBox = el.querySelector('[data-mc="cum"]').parentElement;
    const tip = chartTip(cumBox);
    let cumGeom = null;
    mountCanvas(el.querySelector('[data-mc="cum"]'), 150, (ctx, w, h) => {
      const pad = { l: 46, r: 14, t: 8, b: 20 };
      const X = (days) => pad.l + ((days - mc.minDays) / (mc.maxDays - mc.minDays || 1)) * (w - pad.l - pad.r);
      const Y = (p) => h - pad.b - p * (h - pad.t - pad.b);
      ctx.font = '9px ' + riskCss('--mono');
      for (const p of [0, 0.5, 0.8, 1]) {
        const y = Math.round(Y(p)) + 0.5;
        ctx.strokeStyle = 'rgba(34,48,73,.45)';
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillStyle = riskCss('--dim-2');
        ctx.fillText(`${p * 100}%`, 8, y + 3);
      }
      for (let i = 0; i <= 4; i++) {
        const days = mc.minDays + ((mc.maxDays - mc.minDays) / 4) * i;
        ctx.fillStyle = riskCss('--dim-2');
        ctx.fillText(fmtDate(mc.toDate(days)).slice(0, 6), X(days) - 16, h - 6);
      }
      ctx.strokeStyle = riskCss('--chart-line'); ctx.lineWidth = 2; ctx.beginPath();
      mc.sorted.forEach((f, i) => {
        const x = X(f), y = Y((i + 1) / mc.sorted.length);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      cumGeom = { pad, X, w, h };
    });
    el.querySelector('[data-mc="cum"]').addEventListener('mousemove', (e) => {
      if (!cumGeom) return;
      const rect = e.target.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const days = mc.minDays + ((mx - cumGeom.pad.l) / (cumGeom.w - cumGeom.pad.l - cumGeom.pad.r)) * (mc.maxDays - mc.minDays);
      if (days < mc.minDays || days > mc.maxDays) { tip.hide(); return; }
      const p = mc.sorted.filter((f) => f <= days).length / mc.sorted.length;
      tip.show(`${fmtDate(mc.toDate(days))}<br><b>${(p * 100).toFixed(0)}%</b> chance of finishing by then`, mx, e.clientY - rect.top);
    });
    el.querySelector('[data-mc="cum"]').addEventListener('mouseleave', () => tip.hide());

    const openTask = (t, sub) => openModal(`${t.code} — ${t.name}`, sub, taskModalBody(t, store.model));
    el.querySelectorAll('[data-crit]').forEach((tr) => {
      const open = () => { const c = mc.criticality[+tr.dataset.crit]; openTask(c.t, `critical in ${(c.index * 100).toFixed(0)}% of iterations`); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
    el.querySelectorAll('[data-sens]').forEach((tr) => {
      const open = () => { const s = mc.sensitivity[+tr.dataset.sens]; openTask(s.t, `duration↔finish correlation ${s.r.toFixed(2)}`); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
    el.querySelector('[data-csv]')?.addEventListener('click', () => downloadCSV(
      `schedule_risk_seed${mc.seed}_${mc.iterations}it.csv`,
      ['metric', 'value'],
      [['iterations', mc.iterations], ['seed', mc.seed], ['spread', mc.spread.label],
        ['deterministic_finish', isoDate(mc.deterministicDate)], ['p_deterministic', (mc.pDeterministic * 100).toFixed(1) + '%'],
        ['p10', isoDate(mc.p10.date)], ['p50', isoDate(mc.p50.date)], ['p80', isoDate(mc.p80.date)], ['p90', isoDate(mc.p90.date)],
        ...(mc.constraint ? [['p_meet_mandatory_finish', (mc.constraint.pMeet * 100).toFixed(1) + '%']] : []),
        ...mc.criticality.slice(0, 20).map((c) => [`criticality_${c.t.code}`, (c.index * 100).toFixed(0) + '%']),
        ...mc.sensitivity.slice(0, 20).map((s) => [`sensitivity_${s.t.code}`, s.r.toFixed(3)])]));
  },

  wireControls(el, store) {
    const cfg = ViewRisk.cfg;
    el.querySelector('[data-mc-run]').addEventListener('click', () => {
      cfg.iterations = +el.querySelector('[data-mc-iter]').value;
      cfg.spreadKey = el.querySelector('[data-mc-spread]').value;
      cfg.seed = +el.querySelector('[data-mc-seed]').value || 1;
      ViewRisk.result = null;
      ViewRisk.render(el.closest('.view') || el, store);
    });
  },
};
