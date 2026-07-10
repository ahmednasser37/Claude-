// Gantt — WBS-reach task cards; expanding a card opens the detail modal with
// a canvas mini-Gantt. Critical work is drawn as a dashed outline (same hue,
// not a new color). Every canvas ships a hidden table for screen readers.
import { fmtDate, dayFloor, DAY_MS } from '../kernel/calendar.js';
import { computeEarnedPct } from '../kernel/evm.js';
import { openModal } from '../ui/modal.js';
import { esc, ringSVG, mountCanvas, a11yTable, fmtPct, taskModalBody } from '../ui/components.js';

function subtreeTasks(node) {
  const out = [...node.tasks];
  for (const c of node.children) out.push(...subtreeTasks(c));
  return out;
}

function drawMiniGantt(ctx, w, h, tasks, model) {
  const pad = { l: 74, r: 12, t: 8, b: 22 };
  const t0 = Math.min(...tasks.map((t) => t.targetStart ?? Infinity));
  const t1 = Math.max(...tasks.map((t) => t.targetEnd ?? 0));
  if (!Number.isFinite(t0) || t1 <= t0) return;
  const x = (ms) => pad.l + ((ms - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const rowH = (h - pad.t - pad.b) / tasks.length;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  // month grid
  ctx.strokeStyle = css('--border-soft'); ctx.fillStyle = css('--dim-2');
  ctx.font = '10px ' + css('--mono'); ctx.lineWidth = 1;
  const d0 = new Date(dayFloor(t0));
  let g = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
  while (g < t1) {
    const gx = Math.round(x(g)) + 0.5;
    ctx.beginPath(); ctx.moveTo(gx, pad.t); ctx.lineTo(gx, h - pad.b); ctx.stroke();
    const gd = new Date(g);
    ctx.fillText(`${String(gd.getUTCMonth() + 1).padStart(2, '0')}/${String(gd.getUTCFullYear()).slice(2)}`, gx + 3, h - 8);
    g = Date.UTC(gd.getUTCFullYear(), gd.getUTCMonth() + 3, 1);
  }

  tasks.forEach((t, i) => {
    const y = pad.t + i * rowH;
    const bh = Math.max(Math.min(rowH - 6, 12), 4);
    const by = y + (rowH - bh) / 2;
    ctx.fillStyle = css('--dim-2');
    ctx.font = '10px ' + css('--mono');
    ctx.fillText(t.code.slice(0, 9), 2, by + bh - 1);
    if (t.targetStart === undefined || t.targetEnd === undefined) return;
    const bx = x(t.targetStart);
    const bw = Math.max(x(t.targetEnd) - bx, 2);
    const crit = t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete';
    if (t.milestone) {
      ctx.fillStyle = crit ? css('--bad') : css('--trace');
      const cx = bx, cy = by + bh / 2, s2 = bh / 2 + 1;
      ctx.beginPath(); ctx.moveTo(cx, cy - s2); ctx.lineTo(cx + s2, cy); ctx.lineTo(cx, cy + s2); ctx.lineTo(cx - s2, cy); ctx.closePath(); ctx.fill();
      return;
    }
    ctx.fillStyle = css('--raised-2');
    ctx.fillRect(bx, by, bw, bh);
    const earned = computeEarnedPct(t, model.dataDate);
    if (earned > 0) { ctx.fillStyle = css('--trace'); ctx.fillRect(bx, by, bw * earned, bh); }
    ctx.strokeStyle = crit ? css('--bad') : css('--border');
    ctx.setLineDash(crit ? [4, 3] : []);
    ctx.lineWidth = crit ? 1.5 : 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.setLineDash([]);
  });

  // data date line
  if (model.dataDate !== undefined && model.dataDate > t0 && model.dataDate < t1) {
    const dx = Math.round(x(model.dataDate)) + 0.5;
    ctx.strokeStyle = css('--dim'); ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(dx, pad.t); ctx.lineTo(dx, h - pad.b); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = css('--dim');
    ctx.fillText('DD', dx - 7, pad.t + 8);
  }
}

export const ViewGantt = {
  id: 'gantt', title: 'Gantt', group: 'Schedule',
  chip(store) {
    if (!store.scope) return '';
    const n = store.model.wbsById.get(store.scope);
    return n ? `scope: ${esc(n.shortName || n.name)}` : '';
  },
  render(el, store) {
    const m = store.model;
    const scopeNode = (store.scope && m.wbsById.get(store.scope)) || m.wbsRoot;
    let nodes = scopeNode.children.length ? scopeNode.children : [scopeNode];
    // flatten one more level where a child is only a container
    nodes = nodes.flatMap((n) => (n.tasks.length === 0 && n.children.length ? n.children : [n]));

    const { stats } = store.d.rollup;
    el.innerHTML = `
      <div class="section">
        <h2>Gantt — ${esc(scopeNode.name)}</h2>
        <p class="sub">One card per WBS reach. Open a card for its mini-Gantt; dashed outline marks critical work. Set scope from the WBS view.</p>
        <div class="cardgrid">
          ${nodes.map((n) => {
            const s = stats.get(n.id);
            if (!s || s.taskCount === 0) return '';
            return `<button class="card taskcard" data-node="${esc(n.id)}">
              <div style="display:flex;gap:12px;align-items:center">
                ${ringSVG(s.pct, 'var(--trace)')}
                <div style="min-width:0">
                  <h4>${esc(n.name)}</h4>
                  <div class="meta"><span class="num">${s.taskCount}</span> activities · <span class="num">${s.pct !== undefined ? fmtPct(s.pct) : '—'}</span> earned</div>
                  <div class="meta" style="margin-top:4px">${s.critical ? `<span class="badge-crit">${s.critical} critical</span>` : '<span style="color:var(--dim-2)">no critical work</span>'}</div>
                </div>
              </div>
            </button>`;
          }).join('')}
        </div>
      </div>`;

    el.querySelectorAll('[data-node]').forEach((btn) => btn.addEventListener('click', () => {
      const node = m.wbsById.get(btn.dataset.node);
      const tasks = subtreeTasks(node)
        .filter((t) => t.targetStart !== undefined)
        .sort((a, b) => a.targetStart - b.targetStart || a.targetEnd - b.targetEnd);
      const height = Math.min(Math.max(tasks.length * 20 + 34, 90), 460);
      const card = openModal(node.name, `${tasks.length} activities — planned bars, earned fill, dashed = critical`, `
        <div class="chartbox"><canvas></canvas></div>
        <div class="legend">
          <span><i style="background:var(--raised-2);border:1px solid var(--border);height:8px"></i>planned</span>
          <span><i style="background:var(--trace);height:8px"></i>earned</span>
          <span><i style="background:none;border:1.5px dashed var(--bad);height:8px"></i>critical</span>
        </div>
        ${a11yTable(`Schedule bars for ${node.name}`,
          ['Code', 'Activity', 'Planned start', 'Planned finish', 'Status', 'Critical'],
          tasks.map((t) => [t.code, t.name, fmtDate(t.targetStart), fmtDate(t.targetEnd), t.status,
            t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete' ? 'yes' : 'no']))}
        <div class="tablewrap" style="margin-top:10px"><table class="ledger"><tbody>
          ${tasks.map((t) => `<tr class="rowlink" data-task="${esc(t.id)}" tabindex="0"><td class="num">${esc(t.code)}</td><td>${esc(t.name)}</td><td class="num">${fmtDate(t.targetEnd)}</td></tr>`).join('')}
        </tbody></table></div>`);
      mountCanvas(card.querySelector('canvas'), height, (ctx, w, h) => drawMiniGantt(ctx, w, h, tasks, m));
      card.querySelectorAll('[data-task]').forEach((tr) => tr.addEventListener('click', () => {
        const t = m.taskById.get(tr.dataset.task);
        openModal(`${t.code} — ${t.name}`, esc(node.name), taskModalBody(t, m));
      }));
    }));
  },
};
