// Chainage / Out-of-sequence — a reviewable repair queue, never auto-fixed.
import { openModal } from '../ui/modal.js';
import { esc, statTile, taskModalBody, naTag } from '../ui/components.js';

export const ViewChainage = {
  id: 'chainage', title: 'Chainage / OOS', group: 'Schedule',
  chip(store) {
    const withKp = store.model.tasks.filter((t) => t.chainage !== null);
    if (!withKp.length) return '';
    const kps = withKp.map((t) => t.chainage);
    return `KP <span class="num">${Math.min(...kps).toFixed(1)}–${Math.max(...kps).toFixed(1)}</span>`;
  },
  render(el, store) {
    const m = store.model;
    const oos = store.d.oos;
    const withKp = m.tasks.filter((t) => t.chainage !== null);
    const kps = withKp.map((t) => t.chainage);

    el.innerHTML = `
      <div class="section">
        <h2>Chainage coverage</h2>
        <p class="sub">KP values extracted from activity codes/names (pattern <span class="num">KP###+###</span>). Activities with no match carry no chainage — never a fabricated 0.</p>
        <div class="statrow">
          ${statTile({ id: 'with', label: 'With chainage', value: `<span class="num">${withKp.length}</span>`, note: `of ${m.tasks.length} activities` })}
          ${statTile({ id: 'range', label: 'KP range', value: withKp.length ? `<span class="num">${Math.min(...kps).toFixed(1)}–${Math.max(...kps).toFixed(1)}</span>` : naTag('no KP patterns found'), note: 'kilometre points' })}
          ${statTile({ id: 'oos', label: 'Out of sequence', value: `<span class="num">${oos.length}</span>`, tone: oos.length ? 'warn' : 'good', note: 'succ. behind pred.' })}
        </div>
      </div>

      <div class="section">
        <h2>Repair queue</h2>
        <p class="sub">Relationships whose successor sits behind its predecessor along the alignment (assumes works advance in increasing-KP direction). Review each — nothing is auto-corrected.</p>
        ${oos.length === 0 ? '<div class="empty"><h3>Queue is clear</h3><p>No chainage-reversed relationships found.</p></div>'
        : `<div class="tablewrap"><table class="ledger">
            <thead><tr><th>Predecessor</th><th class="num">KP</th><th>Successor</th><th class="num">KP</th><th class="num">Reversal</th></tr></thead>
            <tbody>${oos.map((o, i) => `<tr class="rowlink" data-oos="${i}" tabindex="0">
              <td class="num">${esc(o.pred.code)}</td><td class="num">${o.predKp.toFixed(3)}</td>
              <td class="num">${esc(o.succ.code)}</td><td class="num">${o.succKp.toFixed(3)}</td>
              <td class="num" style="color:var(--warn)">−${o.deltaKm.toFixed(3)} km</td>
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>`;

    el.querySelectorAll('[data-oos]').forEach((tr) => {
      const open = () => {
        const o = oos[+tr.dataset.oos];
        openModal('Out-of-sequence pair', `${o.pred.code} → ${o.succ.code} (${o.rel.type})`, `
          <dl>
            <dt>Predecessor</dt><dd><span class="num">${esc(o.pred.code)}</span> ${esc(o.pred.name)} — KP <span class="num">${o.predKp.toFixed(3)}</span></dd>
            <dt>Successor</dt><dd><span class="num">${esc(o.succ.code)}</span> ${esc(o.succ.name)} — KP <span class="num">${o.succKp.toFixed(3)}</span></dd>
            <dt>Reversal</dt><dd class="num">${o.deltaKm.toFixed(3)} km against the direction of works</dd>
          </dl>
          <p><b>Suggested review:</b> confirm whether this tie is a genuine constraint (e.g. a tie-in or shared crew returning up-station) or a modelling slip. If it is a slip, re-point the relationship at the activity covering the correct reach. This tool flags; the planner decides.</p>`);
      };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  },
};
