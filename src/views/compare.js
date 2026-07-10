// Compare — three tabs over ONE shared compare.js output. Requires a second
// file; without one the view says so honestly and offers to load it.
import { fmtDate } from '../kernel/calendar.js';
import { openModal } from '../ui/modal.js';
import { esc, fmtMoney, naTag, taskModalBody, statTile } from '../ui/components.js';

const cmpSlip = (v) => v === undefined ? '—'
  : v > 0 ? `<span style="color:var(--bad)">+${v} wd</span>`
  : v < 0 ? `<span style="color:var(--good)">${v} wd</span>`
  : '<span style="color:var(--dim-2)">0</span>';

export const ViewCompare = {
  id: 'compare', title: 'Baseline Compare', group: 'Compare',
  tab: 'activity',
  chip(store) {
    return store.baseline ? `vs <span class="num">${esc(store.baselineName)}</span>` : '';
  },
  render(el, store) {
    if (!store.baseline) {
      el.innerHTML = `
        <div class="empty">
          <h3>No baseline loaded</h3>
          <p>Comparison needs a second .xer export. Activities are matched by <span class="num">task_code</span> — the stable key across P6 re-imports.</p>
          <p style="margin-top:14px">
            <button class="btn" data-load-baseline-file>Load baseline .xer…</button>
            <button class="btn primary" data-load-demo-baseline>Use demo baseline</button>
          </p>
        </div>`;
      el.querySelector('[data-load-demo-baseline]').addEventListener('click', () => store.useDemoBaseline());
      el.querySelector('[data-load-baseline-file]').addEventListener('click', () => store.pickFile('baseline'));
      return;
    }

    const m = store.model;
    const cmp = store.d.cmp;
    const tab = ViewCompare.tab;

    const tabs = [['activity', 'Activity Variance'], ['wbs', 'WBS Variance'], ['crit', 'Critical Path Shift']];
    let body = '';

    if (tab === 'activity') {
      const slipped = cmp.matched.filter((x) => x.slipDays !== undefined && x.slipDays !== 0);
      body = `
        <div class="statrow" style="margin-bottom:16px">
          ${statTile({ id: 'matched', label: 'Matched', value: `<span class="num">${cmp.matched.length}</span>`, note: 'by task_code' })}
          ${statTile({ id: 'added', label: 'Added', value: `<span class="num">${cmp.added.length}</span>`, note: 'in current only' })}
          ${statTile({ id: 'removed', label: 'Removed', value: `<span class="num">${cmp.removed.length}</span>`, note: 'in baseline only' })}
          ${statTile({ id: 'slipped', label: 'Slipped', value: `<span class="num">${slipped.filter((x) => x.slipDays > 0).length}</span>`, tone: 'warn', note: 'later than baseline' })}
        </div>
        <div class="tablewrap"><table class="ledger">
          <thead><tr><th>Activity</th><th class="num">Baseline finish</th><th class="num">Current finish</th><th class="num">Slip</th><th class="num" title="Total float change vs baseline — negative is float consumed">Δ TF</th></tr></thead>
          <tbody>${cmp.matched.slice(0, 60).map((x) => `<tr class="rowlink" data-code="${esc(x.code)}" tabindex="0">
            <td><span class="num">${esc(x.code)}</span> ${esc(x.cur.name.slice(0, 44))}</td>
            <td class="num">${fmtDate(x.baseFinish)}</td>
            <td class="num">${fmtDate(x.curFinish)}</td>
            <td class="num">${cmpSlip(x.slipDays)}</td>
            <td class="num">${x.floatDelta === undefined ? '—' : x.floatDelta < 0 ? `<span style="color:var(--bad)">${x.floatDelta} wd</span>` : `<span style="color:var(--dim)">${x.floatDelta > 0 ? '+' : ''}${x.floatDelta} wd</span>`}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="sub" style="margin-top:10px">Δ TF is float erosion vs baseline — float being consumed is the earliest signal of schedule stress, often before any finish date moves.</p>`;
    } else if (tab === 'wbs') {
      body = `
        <div class="tablewrap"><table class="ledger">
          <thead><tr><th>WBS node</th><th class="num">Cost weight</th><th class="num">Cost-weighted slip</th><th>Worst activity</th></tr></thead>
          <tbody>${cmp.wbsVariance.map((v, i) => `<tr class="rowlink" data-wv="${i}" tabindex="0">
            <td>${esc(v.node ? v.node.name : '(unplaced)')}</td>
            <td class="num">${esc(fmtMoney(v.cost))}</td>
            <td class="num">${v.meanSlip !== undefined ? cmpSlip(+v.meanSlip.toFixed(1)) : naTag('no cost in subtree')}</td>
            <td class="num">${v.worst ? `${esc(v.worst.code)} (${v.worst.slipDays} wd)` : '—'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="sub" style="margin-top:10px">Same cost-weighting rule as the WBS rollup: Σ(cost × slip) ÷ Σ(cost) over matched activities in the node.</p>`;
    } else {
      const list = (title, tasks, tone) => `
        <div class="section">
          <h2>${title} <span class="num" style="color:${tone}">${tasks.length}</span></h2>
          ${tasks.length === 0 ? '<p class="sub">None.</p>' : `<div class="tablewrap"><table class="ledger"><tbody>
            ${tasks.map((t) => `<tr class="rowlink" data-code="${esc(t.code)}" tabindex="0">
              <td class="num">${esc(t.code)}</td><td>${esc(t.name)}</td>
              <td class="num">${t.floatDays !== undefined ? t.floatDays.toFixed(1) + ' wd float' : '—'}</td>
            </tr>`).join('')}</tbody></table></div>`}
        </div>`;
      body = `
        <p class="sub">Set difference of {total float ≤ 0, incomplete} between the two files (current ${cmp.curCritCount} vs baseline ${cmp.baseCritCount}) — deliberately not a re-derived CPM sequence diff.</p>
        ${list('Newly critical', cmp.nowCritical, 'var(--bad)')}
        ${list('No longer critical', cmp.leftCritical, 'var(--good)')}`;
    }

    el.innerHTML = `
      <div class="section">
        <h2>Baseline compare</h2>
        <p class="sub"><b>${esc(store.modelName)}</b> vs baseline <b>${esc(store.baselineName)}</b> — one diff, three lenses.</p>
        <div class="tabs">${tabs.map(([id, label]) => `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>
        ${body}
      </div>`;

    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      ViewCompare.tab = b.dataset.tab;
      ViewCompare.render(el, store);
    }));
    el.querySelectorAll('[data-code]').forEach((tr) => {
      const open = () => {
        const match = cmp.matched.find((x) => x.code === tr.dataset.code);
        const t = m.taskByCode.get(tr.dataset.code) || (match && match.cur);
        if (!t) return;
        const b = store.baseline.taskByCode.get(t.code);
        openModal(`${t.code} — ${t.name}`, 'current vs baseline', `
          ${taskModalBody(t, m)}
          <h4 style="margin:6px 0 4px;font-size:12px;color:var(--dim-2);text-transform:uppercase;letter-spacing:.08em">Baseline</h4>
          ${b ? `<dl><dt>Planned</dt><dd class="num">${fmtDate(b.targetStart)} → ${fmtDate(b.targetEnd)}</dd>
          <dt>Slip</dt><dd class="num">${match && match.slipDays !== undefined ? cmpSlip(match.slipDays) : '—'}</dd></dl>` : naTag('not in baseline (added activity)')}`);
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
    el.querySelectorAll('[data-wv]').forEach((tr) => {
      const open = () => {
        const v = cmp.wbsVariance[+tr.dataset.wv];
        openModal(v.node ? v.node.name : 'Unplaced activities', 'WBS variance detail', `
          <dl>
            <dt>Matched activities</dt><dd class="num">${v.count}</dd>
            <dt>Cost weight</dt><dd class="num">${esc(fmtMoney(v.cost))}</dd>
            <dt>Weighted slip</dt><dd>${v.meanSlip !== undefined ? cmpSlip(+v.meanSlip.toFixed(1)) : naTag('no cost in subtree — slip not weightable')}</dd>
            <dt>Worst</dt><dd>${v.worst ? `<span class="num">${esc(v.worst.code)}</span> at +${v.worst.slipDays} wd` : '—'}</dd>
          </dl>`);
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  },
};
