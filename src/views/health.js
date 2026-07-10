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
      </div>

      <div class="section">
        <h2>Update integrity</h2>
        <p class="sub">Is the latest status update trustworthy? These are recording-quality checks on actual dates and status codes — fix these before believing any metric above.</p>
        <div class="tablewrap"><table class="ledger">
          <thead><tr><th>Check</th><th class="num">Findings</th><th>Status</th></tr></thead>
          <tbody>
            ${store.d.integrity.map((f, i) => `<tr class="rowlink" data-integ="${i}" tabindex="0">
              <td>${esc(f.name)}<div style="color:var(--dim-2);font-size:11.5px;max-width:64ch">${esc(f.why)}</div></td>
              <td class="num">${f.tasks.length}</td>
              <td>${statusPill(f.tasks.length ? 'fail' : 'pass')}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>

      <div class="section">
        <h2>Float bands</h2>
        <p class="sub">The near-critical radar across incomplete work${store.d.bands.unmeasured ? ` (${store.d.bands.unmeasured} with no float in file — not binned, not assumed)` : ''}.</p>
        <div class="tablewrap"><table class="ledger"><tbody>
          ${store.d.bands.bands.map((b, i) => `<tr class="rowlink" data-band="${i}" tabindex="0">
            <td style="width:190px">${esc(b.label)}</td>
            <td class="num" style="width:56px">${b.tasks.length}</td>
            <td><span class="bar" style="display:block;max-width:420px"><i style="width:${store.d.bands.bands.some((x) => x.tasks.length) ? (b.tasks.length / Math.max(...store.d.bands.bands.map((x) => x.tasks.length)) * 100).toFixed(0) : 0}%;background:${b.id === 'neg' || b.id === 'crit' ? 'var(--bad)' : b.id === 'near' ? 'var(--warn)' : 'var(--chart-line)'}"></i></span></td>
          </tr>`).join('')}
        </tbody></table></div>
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

    el.querySelectorAll('[data-integ]').forEach((tr) => {
      const open = () => {
        const f = store.d.integrity[+tr.dataset.integ];
        openModal(f.name, `${f.tasks.length} finding${f.tasks.length === 1 ? '' : 's'}`, `
          <p>${esc(f.why)}</p>
          ${f.tasks.length ? offenderListHTML(f.tasks.map((t) => t.id), store.model, 40) : '<p class="sub">Clean.</p>'}`);
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });

    el.querySelectorAll('[data-band]').forEach((tr) => {
      const open = () => {
        const b = store.d.bands.bands[+tr.dataset.band];
        openModal(b.label, `${b.tasks.length} incomplete activities`, b.tasks.length
          ? `<ul class="offender-list">${b.tasks.map((t) => `<li>${esc(t.code)} · ${t.floatDays.toFixed(1)} wd</li>`).join('')}</ul>`
          : '<p class="sub">None in this band.</p>');
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  },
};
