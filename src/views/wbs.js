// WBS — tree list with cost-weighted rollup. Click opens a modal; scope only
// changes via the modal's explicit "Set as scope" button, never a bare click.
import { openModal, closeModal } from '../ui/modal.js';
import { esc, fmtMoney, fmtPct, naTag, valueOrNA } from '../ui/components.js';

export const ViewWBS = {
  id: 'wbs', title: 'WBS', group: 'Overview',
  chip(store) {
    if (!store.scope) return '';
    const n = store.model.wbsById.get(store.scope);
    return n ? `scope: ${esc(n.shortName || n.name)}` : '';
  },
  render(el, store) {
    const m = store.model;
    const { stats } = store.d.rollup;
    const rows = [];
    const walk = (node, depth) => {
      rows.push({ node, depth, s: stats.get(node.id) });
      for (const c of node.children) walk(c, depth + 1);
    };
    walk(m.wbsRoot, 0);

    el.innerHTML = `
      <div class="section">
        <h2>Work breakdown</h2>
        <p class="sub">Cost-weighted % complete at the data date — Σ(cost × earned) ÷ Σ(cost) per subtree. Click a node for detail.</p>
        <div>
          ${rows.map(({ node, depth, s }) => `
            <button class="wbsrow" data-wbs="${esc(node.id)}" style="padding-left:${10 + depth * 22}px">
              <span class="name"><small>${esc(node.shortName)}</small>${esc(node.name)}</span>
              <span class="cnt">${s.taskCount} act</span>
              <span class="pctbar"><span class="bar"><i class="${store.scope === node.id ? 'brass' : ''}" style="width:${s.pct !== undefined ? (s.pct * 100).toFixed(1) : 0}%"></i></span></span>
              <span class="pct">${s.pct !== undefined ? (s.pct * 100).toFixed(1) + '%' : '—'}</span>
            </button>`).join('')}
        </div>
      </div>`;

    el.querySelectorAll('[data-wbs]').forEach((btn) => btn.addEventListener('click', () => {
      const node = m.wbsById.get(btn.dataset.wbs);
      const s = stats.get(node.id);
      const card = openModal(node.name, `WBS ${node.shortName || node.id}`, `
        <dl>
          <dt>% complete</dt><dd>${s.pct !== undefined ? `<span class="num">${fmtPct(s.pct)}</span> (cost-weighted)` : naTag('no cost assigned in subtree')}</dd>
          <dt>Budget</dt><dd class="num">${fmtMoney(s.cost)}</dd>
          <dt>Earned</dt><dd class="num">${fmtMoney(s.earned)}</dd>
          <dt>Actual cost</dt><dd class="num">${fmtMoney(s.actual)}</dd>
          <dt>Activities</dt><dd class="num">${s.taskCount} (${s.done} done · ${s.active} active · ${s.notStarted} not started)</dd>
          <dt>Critical</dt><dd class="num">${s.critical}</dd>
        </dl>`,
        `<button class="btn small" data-clear-scope ${store.scope ? '' : 'disabled'}>Clear scope</button>
         <button class="btn small primary" data-set-scope>Set as scope</button>`);
      card.querySelector('[data-set-scope]').addEventListener('click', () => {
        store.set({ scope: node.id }); closeModal();
      });
      card.querySelector('[data-clear-scope]')?.addEventListener('click', () => {
        store.set({ scope: null }); closeModal();
      });
    }));
  },
};
