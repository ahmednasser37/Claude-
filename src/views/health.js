// Health — the DCMA 14-Point Assessment, named as such. Each check opens a
// modal with formula, threshold, measured value and offenders (or the honest
// reason it isn't computable).
import { openModal } from '../ui/modal.js';
import { esc, statusPill, fmtPct, offenderListHTML } from '../ui/components.js';

function dcmaValueText(c) {
  if (c.value === null || c.value === undefined) return '—';
  if (c.id === 7 || c.id === 9) return String(c.count);
  if (c.id === 13 || c.id === 14 || c.id === 12) return c.value.toFixed(2);
  return fmtPct(c.value);
}

export const ViewHealth = {
  id: 'health', title: 'Schedule Health', group: 'Overview',
  chip(store) {
    const d = store.d.dcma;
    return `<span class="num">${d.filter((c) => c.status === 'pass').length}</span> pass · <span class="num">${d.filter((c) => c.status === 'fail').length}</span> fail`;
  },
  render(el, store) {
    const checks = store.d.dcma;
    el.innerHTML = `
      <div class="section">
        <h2>DCMA 14-Point Assessment</h2>
        <p class="sub">The standard PMO schedule-quality rubric, computed from this file${store.baseline ? ' and the loaded baseline' : ''}. Checks that need data this file doesn't carry say so — nothing is defaulted.</p>
        <div class="tablewrap"><table class="ledger">
          <thead><tr><th class="num">#</th><th>Check</th><th class="num">Value</th><th>Threshold</th><th>Status</th></tr></thead>
          <tbody>
            ${checks.map((c) => `<tr class="rowlink" data-check="${c.id}" tabindex="0">
              <td class="num">${c.id}</td>
              <td>${esc(c.name)}${c.status === 'na' ? ` <span style="color:var(--dim-2);font-size:11.5px">· ${esc(c.reason)}</span>` : ''}</td>
              <td class="num">${dcmaValueText(c)}</td>
              <td style="color:var(--dim)">${esc(c.threshold)}</td>
              <td>${statusPill(c.status)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;

    el.querySelectorAll('[data-check]').forEach((tr) => {
      const open = () => {
        const c = checks.find((x) => x.id === +tr.dataset.check);
        openModal(`${c.id}. ${c.name}`, `threshold: ${c.threshold}`, `
          <kbd class="formula">${esc(c.formula)}</kbd>
          <dl>
            <dt>Status</dt><dd>${statusPill(c.status)}</dd>
            <dt>Measured</dt><dd class="num">${dcmaValueText(c)}${c.count !== undefined && c.total !== undefined ? ` &nbsp;(${c.count} of ${c.total})` : ''}</dd>
            ${c.reason ? `<dt>Note</dt><dd>${esc(c.reason)}</dd>` : ''}
          </dl>
          ${c.offenders && c.offenders.length ? `<h4 style="margin:10px 0 0;font-size:12px;color:var(--dim-2);text-transform:uppercase;letter-spacing:.08em">Offending items</h4>${offenderListHTML(c.offenders, store.model)}` : ''}`);
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  },
};
