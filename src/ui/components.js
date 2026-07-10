// components.js — shared UI helpers. May touch DOM; never touches the kernel's
// internals beyond reading the model.

import { fmtDate } from '../kernel/calendar.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtMoney(v, currency = 'SAR') {
  if (v === undefined || v === null) return 'N/A';
  const abs = Math.abs(v);
  const s = abs >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : abs >= 1e3 ? (v / 1e3).toFixed(0) + 'k' : v.toFixed(0);
  return `${s} ${currency}`;
}

export function fmtRatio(v) {
  return v === undefined || v === null ? null : v.toFixed(2);
}

export function fmtPct(v, digits = 1) {
  return v === undefined || v === null ? null : (v * 100).toFixed(digits) + '%';
}

// The non-negotiable: a missing value renders as an explicit N/A with a
// reason, never a placeholder zero.
export function naTag(reason) {
  return `<span class="na-tag" title="${esc(reason)}">N/A — ${esc(reason)}</span>`;
}

export function valueOrNA(formatted, reason) {
  return formatted === null || formatted === undefined ? naTag(reason || 'not in file') : `<span class="num">${esc(formatted)}</span>`;
}

export function statusPill(status) {
  const label = { pass: 'pass', fail: 'fail', warn: 'warn', na: 'n/a', info: 'info' }[status] || status;
  return `<span class="pill ${esc(status)}">${esc(label)}</span>`;
}

export const reducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Count-up for KPI numbers. Renders the final string immediately for
// reduced-motion users; nothing downstream may depend on intermediate frames.
export function countUp(el, target, format = (v) => String(Math.round(v)), duration = 550) {
  if (reducedMotion() || !Number.isFinite(target)) { el.textContent = format(target); return; }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min((t - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = format(target * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function statTile({ label, value, note, tone, id }) {
  return `<button class="stat" data-stat="${esc(id)}">
    <div class="label">${esc(label)}</div>
    <div class="value ${esc(tone || '')}">${value}</div>
    ${note ? `<div class="note">${note}</div>` : ''}
  </button>`;
}

export function taskLine(t) {
  return `<span class="num">${esc(t.code)}</span> ${esc(t.name)}`;
}

export function taskModalBody(t, model) {
  const rows = [
    ['Status', { TK_NotStart: 'Not started', TK_Active: 'In progress', TK_Complete: 'Complete' }[t.status] || t.status],
    ['WBS', esc(model.wbsById.get(t.wbsId)?.name || t.wbsId)],
    ['Planned', `<span class="num">${fmtDate(t.targetStart)} → ${fmtDate(t.targetEnd)}</span>`],
    ['Actual', t.actStart !== undefined
      ? `<span class="num">${fmtDate(t.actStart)} → ${t.actEnd !== undefined ? fmtDate(t.actEnd) : 'in progress'}</span>`
      : naTag('no actual start recorded')],
    ['Duration', t.origDays !== undefined ? `<span class="num">${t.origDays} wd</span>` : naTag('target dates missing')],
    ['Total float', t.totalFloatHrs !== undefined ? `<span class="num">${(t.floatDays).toFixed(1)} wd</span>` : naTag('not populated (typical for completed work)')],
    ['Physical %', t.physPct !== undefined ? `<span class="num">${t.physPct}%</span>` : naTag('not recorded')],
    ['Budget', `<span class="num">${esc(fmtMoney(t.targetCost))}</span>`],
    ['Actual cost', t.actualCost ? `<span class="num">${esc(fmtMoney(t.actualCost))}</span>` : naTag('no actuals booked')],
    ['Constraint', t.cstrType ? `<span class="num">${esc(t.cstrType)} ${fmtDate(t.cstrDate)}</span>` : 'none'],
    ['Chainage', t.chainage !== null ? `<span class="num">KP ${t.chainage.toFixed(3)}</span>` : naTag('no KP pattern in code/name')],
    ['Calendar', esc(t.cal.name)],
  ];
  return `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

// ---------- canvas plumbing ----------

// Sizes a canvas to its box at devicePixelRatio and calls draw(ctx, w, h).
// Returns a redraw function; re-runs on resize.
export function mountCanvas(canvas, heightPx, draw) {
  const render = () => {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = heightPx + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(heightPx * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, heightPx);
    draw(ctx, w, heightPx);
  };
  const ro = new ResizeObserver(() => render());
  ro.observe(canvas.parentElement);
  requestAnimationFrame(render);
  return render;
}

export function chartTip(box) {
  let tip = box.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    box.appendChild(tip);
  }
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.style.display = 'block';
      const bw = box.clientWidth;
      tip.style.left = Math.min(x + 14, bw - tip.offsetWidth - 6) + 'px';
      tip.style.top = Math.max(y - tip.offsetHeight - 10, 4) + 'px';
    },
    hide() { tip.style.display = 'none'; },
  };
}

// Hidden, screen-reader-exposed table beside every canvas chart — canvas has
// no accessibility tree.
export function a11yTable(caption, headers, rows) {
  return `<div class="visually-hidden"><table>
    <caption>${esc(caption)}</caption>
    <thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

export function ringSVG(pct, color, size = 52) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const filled = pct === null || pct === undefined ? 0 : Math.min(Math.max(pct, 0), 1);
  return `<svg width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--raised-2)" stroke-width="5"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="5"
      stroke-linecap="round" stroke-dasharray="${(filled * c).toFixed(1)} ${c.toFixed(1)}"/>
  </svg>`;
}

export function offenderListHTML(offenders, model, cap = 24) {
  if (!offenders || offenders.length === 0) return '<p class="sub" style="color:var(--dim)">No offending items.</p>';
  const names = offenders.slice(0, cap).map((id) => {
    const t = model.taskById.get(id);
    return `<li>${esc(t ? t.code : id)}</li>`;
  }).join('');
  const more = offenders.length > cap ? `<li>… and ${offenders.length - cap} more</li>` : '';
  return `<ul class="offender-list">${names}${more}</ul>`;
}
