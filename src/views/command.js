// Command — the Observatory. A radial chronometer (the plan span as a ring,
// activities as concentric arcs per WBS band, the data date as a needle) and
// a constellation map (activities as stars on time × chainage, relationships
// as hairlines). Both canvases are hit-tested: every arc and star opens the
// real task modal. All numbers remain the kernel's — the exotic skin never
// invents data.
import { fmtDate, dayFloor } from '../kernel/calendar.js';
import { computeEarnedPct } from '../kernel/evm.js';
import { openModal } from '../ui/modal.js';
import {
  esc, fmtMoney, fmtRatio, fmtPct, statTile, valueOrNA, naTag, countUp,
  statusPill, taskModalBody, mountCanvas, chartTip, a11yTable,
} from '../ui/components.js';

const TAU = Math.PI * 2;

function cssVar(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

function planSpan(m) {
  let t0 = Infinity, t1 = 0;
  for (const t of m.tasks) {
    if (t.targetStart !== undefined) t0 = Math.min(t0, t.targetStart);
    if (t.targetEnd !== undefined) t1 = Math.max(t1, t.targetEnd);
  }
  return [t0, t1];
}

// ---------- the chronometer dial ----------
function drawDial(ctx, w, h, m, bands, hits) {
  hits.length = 0;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 26;
  const [t0, t1] = planSpan(m);
  if (!Number.isFinite(t0) || t1 <= t0) return;
  const ang = (ms) => -Math.PI / 2 + ((ms - t0) / (t1 - t0)) * TAU;

  // month ring + ticks
  ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, TAU); ctx.stroke();
  ctx.font = '9px ' + cssVar('--mono');
  const d0 = new Date(dayFloor(t0));
  let mth = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
  while (mth < t1) {
    const a = ang(mth);
    const x1 = cx + Math.cos(a) * (R + 10), y1 = cy + Math.sin(a) * (R + 10);
    const x2 = cx + Math.cos(a) * (R + 18), y2 = cy + Math.sin(a) * (R + 18);
    ctx.strokeStyle = cssVar('--dim-2');
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const md = new Date(mth);
    if (md.getUTCMonth() % 2 === 0) {
      ctx.fillStyle = cssVar('--dim-2');
      const lx = cx + Math.cos(a) * (R + 24), ly = cy + Math.sin(a) * (R + 24);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${String(md.getUTCMonth() + 1).padStart(2, '0')}/${String(md.getUTCFullYear()).slice(2)}`, lx, ly);
    }
    mth = Date.UTC(md.getUTCFullYear(), md.getUTCMonth() + 1, 1);
  }

  // WBS bands: concentric arcs, outermost = first band
  const rInner = R * 0.34;
  const bandW = (R - rInner) / Math.max(bands.length, 1);
  bands.forEach((band, bi) => {
    const r = R - bi * bandW - bandW / 2;
    // faint orbit line
    ctx.strokeStyle = 'rgba(76,88,113,.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    for (const t of band.tasks) {
      if (t.targetStart === undefined || t.targetEnd === undefined) continue;
      const a0 = ang(t.targetStart), a1 = Math.max(ang(t.targetEnd), a0 + 0.012);
      const crit = t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete';
      ctx.lineWidth = Math.max(bandW * 0.5, 3);
      ctx.lineCap = 'round';
      if (crit) {
        ctx.strokeStyle = 'rgba(255,111,102,.28)'; ctx.lineWidth += 4;
        ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
        ctx.lineWidth -= 4;
      }
      ctx.strokeStyle = crit ? cssVar('--bad')
        : t.status === 'TK_Complete' ? 'rgba(38,165,161,.85)'
        : t.status === 'TK_Active' ? cssVar('--accent')
        : 'rgba(76,88,113,.6)';
      ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
      if (t.milestone) {
        const mx = cx + Math.cos(a0) * r, my = cy + Math.sin(a0) * r;
        ctx.fillStyle = crit ? cssVar('--bad') : cssVar('--text');
        ctx.beginPath(); ctx.arc(mx, my, 2.6, 0, TAU); ctx.fill();
      }
      hits.push({ kind: 'arc', t, r, a0, a1, tol: Math.max(bandW * 0.4, 5) });
    }
  });

  // data-date needle
  if (m.dataDate !== undefined && m.dataDate >= t0 && m.dataDate <= t1) {
    const a = ang(m.dataDate);
    const nx = cx + Math.cos(a) * (R + 8), ny = cy + Math.sin(a) * (R + 8);
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 1.2;
    ctx.shadowColor = cssVar('--accent'); ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * rInner * 0.6, cy + Math.sin(a) * rInner * 0.6); ctx.lineTo(nx, ny); ctx.stroke();
    ctx.beginPath(); ctx.arc(nx, ny, 3, 0, TAU); ctx.fillStyle = cssVar('--accent'); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // center readout
  ctx.textAlign = 'center';
  ctx.fillStyle = cssVar('--text');
  ctx.font = '300 30px ' + cssVar('--mono');
  ctx.fillText(window.__prismDialCenter || '', cx, cy - 2);
  ctx.fillStyle = cssVar('--dim-2');
  ctx.font = '9px ' + cssVar('--mono');
  ctx.fillText('E A R N E D', cx, cy + 18);
  ctx.textAlign = 'left';
}

// ---------- the constellation map ----------
function drawConstellation(ctx, w, h, m, hits) {
  hits.length = 0;
  const pad = { l: 56, r: 14, t: 14, b: 24 };
  const [t0, t1] = planSpan(m);
  if (!Number.isFinite(t0) || t1 <= t0) return;
  const kps = m.tasks.filter((t) => t.chainage !== null).map((t) => t.chainage);
  const kpMin = Math.min(...kps), kpMax = Math.max(...kps);
  const noKp = m.tasks.filter((t) => t.chainage === null && t.targetStart !== undefined);
  const X = (ms) => pad.l + ((ms - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const laneH = 16;
  const topBand = noKp.length ? Math.min(noKp.length, 6) * laneH + 10 : 0;
  const Y = (t, i) => {
    if (t.chainage !== null && kpMax > kpMin) {
      return pad.t + topBand + ((t.chainage - kpMin) / (kpMax - kpMin)) * (h - pad.t - pad.b - topBand - 8);
    }
    return pad.t + (i % 6) * laneH + 6;
  };
  const pos = new Map();
  let idx = 0;
  for (const t of m.tasks) {
    if (t.targetStart === undefined || t.targetEnd === undefined) continue;
    const mid = (t.targetStart + t.targetEnd) / 2;
    pos.set(t.id, { x: X(mid), y: Y(t, t.chainage === null ? idx++ : 0), t });
  }

  // KP gridlines
  ctx.font = '9px ' + cssVar('--mono');
  if (kps.length && kpMax > kpMin) {
    for (let kp = Math.ceil(kpMin / 6) * 6; kp <= kpMax; kp += 6) {
      const y = pad.t + topBand + ((kp - kpMin) / (kpMax - kpMin)) * (h - pad.t - pad.b - topBand - 8);
      ctx.strokeStyle = 'rgba(34,48,73,.4)';
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillStyle = cssVar('--dim-2');
      ctx.fillText(`KP${kp}`, 8, y + 3);
    }
  }
  // time ticks (quarters)
  const q0 = new Date(dayFloor(t0));
  let q = Date.UTC(q0.getUTCFullYear(), Math.floor(q0.getUTCMonth() / 3) * 3 + 3, 1);
  while (q < t1) {
    const x = X(q);
    ctx.strokeStyle = 'rgba(34,48,73,.35)';
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    const qd = new Date(q);
    ctx.fillStyle = cssVar('--dim-2');
    ctx.fillText(`${String(qd.getUTCMonth() + 1).padStart(2, '0')}/${String(qd.getUTCFullYear()).slice(2)}`, x - 12, h - 9);
    q = Date.UTC(qd.getUTCFullYear(), qd.getUTCMonth() + 3, 1);
  }

  // relationship hairlines
  for (const p of m.preds) {
    const a = pos.get(p.predTaskId), b = pos.get(p.taskId);
    if (!a || !b) continue;
    const critLink = [a.t, b.t].every((t) => t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete');
    ctx.strokeStyle = critLink ? 'rgba(255,111,102,.4)' : 'rgba(110,231,226,.1)';
    ctx.lineWidth = critLink ? 1.1 : 0.7;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // stars
  for (const { x, y, t } of pos.values()) {
    const crit = t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete';
    const rad = Math.max(Math.sqrt((t.targetCost || 40000) / 1e6) * 3.4, 2.2);
    const color = crit ? cssVar('--bad')
      : t.status === 'TK_Complete' ? 'rgba(38,165,161,.9)'
      : t.status === 'TK_Active' ? cssVar('--accent')
      : 'rgba(139,151,173,.65)';
    if (crit || t.status === 'TK_Active') {
      ctx.shadowColor = color; ctx.shadowBlur = 10;
    }
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    if (t.milestone) {
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, rad + 3, 0, TAU); ctx.stroke();
    }
    hits.push({ kind: 'star', t, x, y, tol: rad + 5 });
  }

  // data-date scan line
  if (m.dataDate !== undefined && m.dataDate > t0 && m.dataDate < t1) {
    const x = X(m.dataDate);
    const grad = ctx.createLinearGradient(x - 26, 0, x, 0);
    grad.addColorStop(0, 'rgba(110,231,226,0)');
    grad.addColorStop(1, 'rgba(110,231,226,.10)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - 26, pad.t, 26, h - pad.t - pad.b);
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cssVar('--accent');
    ctx.fillText('DATA DATE', x + 5, pad.t + 9);
  }
}

function wireCanvasHits(canvas, box, m, hits, isDial) {
  const tip = chartTip(box);
  const find = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (isDial) {
      const cx = rect.width / 2, cy = rect.height / 2;
      const dx = mx - cx, dy = my - cy;
      const r = Math.hypot(dx, dy);
      let a = Math.atan2(dy, dx);
      for (const hh of hits) {
        if (Math.abs(r - hh.r) > hh.tol) continue;
        let aa = a;
        while (aa < hh.a0) aa += TAU;
        if (aa <= hh.a1 + 0.02) return hh;
      }
      return null;
    }
    let best = null, bestD = Infinity;
    for (const hh of hits) {
      const d = Math.hypot(mx - hh.x, my - hh.y);
      if (d <= hh.tol && d < bestD) { best = hh; bestD = d; }
    }
    return best;
  };
  canvas.addEventListener('mousemove', (e) => {
    const hit = find(e);
    canvas.style.cursor = hit ? 'pointer' : 'default';
    if (!hit) { tip.hide(); return; }
    const rect = canvas.getBoundingClientRect();
    const t = hit.t;
    tip.show(`<span class="num">${esc(t.code)}</span> ${esc(t.name.slice(0, 38))}<br>` +
      `<b>${fmtDate(t.targetStart)} → ${fmtDate(t.targetEnd)}</b>` +
      (t.chainage !== null ? `<br>KP <b>${t.chainage.toFixed(1)}</b>` : ''),
      e.clientX - rect.left, e.clientY - rect.top);
  });
  canvas.addEventListener('mouseleave', () => tip.hide());
  canvas.addEventListener('click', (e) => {
    const hit = find(e);
    if (hit) openModal(`${hit.t.code} — ${hit.t.name}`, 'telemetry detail', taskModalBody(hit.t, m));
  });
}

export const ViewCommand = {
  id: 'command', title: 'Observatory', group: 'Overview',
  chip(store) {
    const m = store.model;
    return m ? `as of <span class="num">${fmtDate(m.dataDate)}</span>` : '';
  },
  render(el, store) {
    const m = store.model;
    const { evm, dcma } = store.d;
    const critical = m.tasks.filter((t) => t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete');
    const dcmaPass = dcma.filter((c) => c.status === 'pass').length;
    const dcmaNA = dcma.filter((c) => c.status === 'na').length;
    const spiTone = evm.spi.value === null ? '' : evm.spi.value >= 0.95 ? 'good' : evm.spi.value >= 0.85 ? 'warn' : 'bad';
    const cpiTone = evm.cpi.value === null ? '' : evm.cpi.value >= 0.95 ? 'good' : evm.cpi.value >= 0.85 ? 'warn' : 'bad';

    // dial bands: level-1 WBS nodes that carry tasks in their subtree
    const bands = [];
    const gather = (node) => {
      const out = [...node.tasks];
      for (const c of node.children) out.push(...gather(c));
      return out;
    };
    for (const child of m.wbsRoot.children) {
      const tasks = gather(child);
      if (tasks.length) bands.push({ name: child.name, tasks });
    }
    if (!bands.length) bands.push({ name: m.wbsRoot.name, tasks: m.tasks });
    window.__prismDialCenter = evm.earnedPct !== undefined ? (evm.earnedPct * 100).toFixed(1) + '%' : '—';

    el.innerHTML = `
      <div class="banner">
        <b>${esc(store.modelName)}</b>
        <span>data date ${fmtDate(m.dataDate)} · <span class="num">${esc(m.dataDateSource || 'n/a')}</span></span>
        ${store.baseline ? `<span>baseline <b>${esc(store.baselineName)}</b></span>` : `<span>${naTag('no baseline loaded — compare & 3 DCMA checks unavailable')}</span>`}
      </div>

      <div class="section">
        <h2>Observatory</h2>
        <p class="sub">The plan span as one revolution; each orbit is a WBS band, each arc an activity. The needle is the data date. Hover to read, click to open — arcs and stars are live.</p>
        <div class="observatory">
          <div class="dialbox chartbox"><canvas></canvas></div>
          <div class="readouts">
            <div class="statrow">
              ${statTile({ id: 'acts', label: 'Activities', value: '<span data-count="acts">0</span>', note: `${m.preds.length} relationships` })}
              ${statTile({ id: 'crit', label: 'Critical', value: `<span data-count="crit">0</span>`, note: 'float ≤ 0, incomplete', tone: critical.length ? 'bad' : 'good' })}
            </div>
            <div class="statrow">
              ${statTile({ id: 'spi', label: 'SPI', value: valueOrNA(fmtRatio(evm.spi.value), evm.spi.reason), tone: spiTone, note: 'EV ÷ PV at data date' })}
              ${statTile({ id: 'cpi', label: 'CPI', value: valueOrNA(fmtRatio(evm.cpi.value), evm.cpi.reason), tone: cpiTone, note: 'EV ÷ AC' })}
            </div>
            <div class="statrow">
              ${statTile({ id: 'spit', label: 'SPI(t)', value: valueOrNA(fmtRatio(evm.es.value), evm.es.reason), tone: evm.es.value === null ? '' : evm.es.value >= 0.95 ? 'good' : evm.es.value >= 0.85 ? 'warn' : 'bad', note: 'earned schedule ÷ actual time' })}
              ${statTile({ id: 'earned', label: '% Earned', value: valueOrNA(fmtPct(evm.earnedPct), 'no costs in file'), note: `of ${fmtMoney(evm.bac)} BAC` })}
            </div>
            <div class="statrow">
              ${statTile({ id: 'dcma', label: 'DCMA', value: `<span class="num">${dcmaPass}/${14 - dcmaNA}</span>`, note: dcmaNA ? `${dcmaNA} not computable` : 'all computable', tone: dcmaPass >= 10 ? 'good' : 'warn' })}
              ${statTile({ id: 'lpath', label: 'Longest path', value: `<span class="num">${store.d.lpath.cyclic ? '—' : store.d.lpath.path.length}</span>`, note: 'activities driving finish' })}
            </div>
          </div>
        </div>
        ${a11yTable('Activities by WBS band', ['Band', 'Activities'], bands.map((b) => [b.name, b.tasks.length]))}
      </div>

      <div class="section">
        <h2>Constellation</h2>
        <p class="sub">Every activity as a star — time across, chainage down (unchainaged work rides the top lanes). Hairlines are relationships; the red thread is the critical chain. Click a star for its telemetry.</p>
        <div class="chartbox"><canvas data-map></canvas></div>
        <div class="legend">
          <span><i class="dot" style="background:rgba(38,165,161,.9)"></i>complete</span>
          <span><i class="dot" style="background:var(--accent)"></i>in progress</span>
          <span><i class="dot" style="background:rgba(139,151,173,.65)"></i>not started</span>
          <span><i class="dot" style="background:var(--bad)"></i>critical</span>
        </div>
        ${a11yTable('Activity constellation', ['Code', 'Activity', 'Start', 'Finish', 'KP', 'Status'],
          m.tasks.map((t) => [t.code, t.name, fmtDate(t.targetStart), fmtDate(t.targetEnd),
            t.chainage !== null ? t.chainage.toFixed(1) : 'n/a', t.status]))}
      </div>

      <div class="section">
        <h2>Tables parsed</h2>
        <p class="sub">Raw parse sanity — one in-memory model feeds every view.</p>
        <div class="tablewrap"><table class="ledger">
          <thead><tr><th>Table</th><th class="num">Rows</th><th>Fields present</th></tr></thead>
          <tbody>
            ${m.tablesSummary.map((t) => `<tr class="rowlink" data-table="${esc(t.name)}" tabindex="0">
              <td class="num">${esc(t.name)}</td><td class="num">${t.rows}</td>
              <td style="color:var(--dim)">${esc(Object.keys((m.raw[t.name] || [])[0] || {}).slice(0, 6).join(', '))}${Object.keys((m.raw[t.name] || [])[0] || {}).length > 6 ? '…' : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;

    countUp(el.querySelector('[data-count="acts"]'), m.tasks.length, (v) => String(Math.round(v)));
    countUp(el.querySelector('[data-count="crit"]'), critical.length, (v) => String(Math.round(v)));

    const dialCanvas = el.querySelector('.dialbox canvas');
    const dialHits = [];
    const dialSize = Math.min(460, Math.max(dialCanvas.parentElement.clientWidth || 420, 300));
    mountCanvas(dialCanvas, dialSize, (ctx, w, h) => drawDial(ctx, w, h, m, bands, dialHits));
    wireCanvasHits(dialCanvas, dialCanvas.parentElement, m, dialHits, true);

    const mapCanvas = el.querySelector('[data-map]');
    const mapHits = [];
    mountCanvas(mapCanvas, 340, (ctx, w, h) => drawConstellation(ctx, w, h, m, mapHits));
    wireCanvasHits(mapCanvas, mapCanvas.parentElement, m, mapHits, false);

    const statModals = {
      acts: () => openModal('Activities', `${m.tasks.length} in file`, `
        <dl>
          <dt>Total</dt><dd class="num">${m.tasks.length}</dd>
          <dt>Complete</dt><dd class="num">${m.tasks.filter((t) => t.status === 'TK_Complete').length}</dd>
          <dt>In progress</dt><dd class="num">${m.tasks.filter((t) => t.status === 'TK_Active').length}</dd>
          <dt>Not started</dt><dd class="num">${m.tasks.filter((t) => t.status === 'TK_NotStart').length}</dd>
          <dt>Milestones</dt><dd class="num">${m.tasks.filter((t) => t.milestone).length}</dd>
          <dt>Relationships</dt><dd class="num">${m.preds.length}</dd>
        </dl>`),
      spi: () => openModal('Schedule Performance Index', 'EVM per PMI/AACE convention', `
        <kbd class="formula">SPI = EV ÷ PV at the data date = ${fmtMoney(evm.ev)} ÷ ${evm.pvAtDD !== undefined ? fmtMoney(evm.pvAtDD) : 'N/A'}</kbd>
        <p>${evm.spi.value === null ? esc(evm.spi.reason) : `The project has earned <b class="num">${fmtPct(evm.ev / evm.bac)}</b> of BAC against <b class="num">${fmtPct(evm.pvAtDD / evm.bac)}</b> planned by ${fmtDate(m.dataDate)}.`}</p>
        <p style="color:var(--dim);font-size:12.5px">EV and AC are single points at the data date — one XER file carries one snapshot of actuals, so no EV/AC history is shown anywhere in this tool.</p>`),
      cpi: () => openModal('Cost Performance Index', 'EVM per PMI/AACE convention', `
        <kbd class="formula">CPI = EV ÷ AC = ${fmtMoney(evm.ev)} ÷ ${fmtMoney(evm.ac)}</kbd>
        <dl>
          <dt>BAC</dt><dd class="num">${fmtMoney(evm.bac)}</dd>
          <dt>EAC</dt><dd>${evm.eac !== undefined ? `<span class="num">${fmtMoney(evm.eac)}</span>` : naTag('CPI not computable')}</dd>
          <dt>ETC</dt><dd>${evm.etc !== undefined ? `<span class="num">${fmtMoney(evm.etc)}</span>` : naTag('CPI not computable')}</dd>
          <dt>VAC</dt><dd>${evm.vac !== undefined ? `<span class="num">${fmtMoney(evm.vac)}</span>` : naTag('CPI not computable')}</dd>
          <dt>TCPI</dt><dd>${evm.tcpi !== undefined ? `<span class="num">${evm.tcpi.toFixed(2)}</span>` : naTag('BAC = AC')}</dd>
        </dl>`),
      earned: () => openModal('% Earned', 'cost-weighted, at the data date', `
        <kbd class="formula">Σ(activity cost × earned %) ÷ Σ(activity cost), earned % from phys_complete_pct (÷100) or schedule-elapsed, 0 for unstarted work</kbd>
        <dl><dt>EV</dt><dd class="num">${fmtMoney(evm.ev)}</dd><dt>BAC</dt><dd class="num">${fmtMoney(evm.bac)}</dd></dl>`),
      spit: () => openModal('Earned Schedule — SPI(t)', 'Lipke time-based schedule performance', evm.es.value === null
        ? `<p>${esc(evm.es.reason)}</p>`
        : `<kbd class="formula">ES = ${evm.es.es.toFixed(2)} ${evm.es.unit} of plan earned · AT = ${evm.es.at.toFixed(2)} ${evm.es.unit} elapsed · SPI(t) = ES ÷ AT = ${evm.es.value.toFixed(2)}</kbd>
           <p>The project has earned the plan's first <b class="num">${evm.es.es.toFixed(1)}</b> ${evm.es.unit} of value in <b class="num">${evm.es.at.toFixed(1)}</b> ${evm.es.unit} of actual time — <b class="num">${Math.abs(evm.es.svt).toFixed(1)}</b> ${evm.es.unit} ${evm.es.svt < 0 ? 'behind' : 'ahead of'} plan in time units. Unlike cost-based SPI, SPI(t) does not drift back to 1.0 as a late project approaches completion.</p>`),
      lpath: () => openModal('Longest path', 'driving chain from the CPM engine', store.d.lpath.cyclic
        ? '<p>Network is cyclic — no longest path derivable.</p>'
        : `<ul class="offender-list">${store.d.lpath.path.map((id) => `<li>${esc(store.model.taskById.get(id)?.code || id)}</li>`).join('')}</ul>
           <p style="color:var(--dim);font-size:12.5px;margin-top:10px">Full detail on the Schedule Health view.</p>`),
      crit: () => openModal('Critical activities', 'total float ≤ 0, not complete', critical.length
        ? `<ul class="offender-list">${critical.map((t) => `<li>${esc(t.code)}</li>`).join('')}</ul>`
        : '<p>No activities with float ≤ 0.</p>'),
      dcma: () => openModal('DCMA 14-Point Assessment', `${dcmaPass} pass of ${14 - dcmaNA} computable`, `
        <div class="tablewrap"><table class="ledger"><tbody>
          ${dcma.map((c) => `<tr><td class="num">${c.id}</td><td>${esc(c.name)}</td><td>${statusPill(c.status)}</td></tr>`).join('')}
        </tbody></table></div>
        <p style="color:var(--dim);font-size:12.5px;margin-top:10px">Full detail on the Schedule Health view.</p>`),
    };
    el.querySelectorAll('[data-stat]').forEach((b) =>
      b.addEventListener('click', () => statModals[b.dataset.stat]?.()));

    el.querySelectorAll('[data-table]').forEach((tr) => {
      const open = () => {
        const name = tr.dataset.table;
        const rows = m.raw[name] || [];
        const fields = Object.keys(rows[0] || {});
        openModal(`%T ${name}`, `${rows.length} rows`, `
          <dl><dt>Fields</dt><dd class="num" style="font-size:12px">${esc(fields.join(', ') || '—')}</dd></dl>
          ${rows.length ? `<kbd class="formula">first row: ${esc(JSON.stringify(rows[0]).slice(0, 420))}${JSON.stringify(rows[0]).length > 420 ? '…' : ''}</kbd>` : ''}`);
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  },
};
