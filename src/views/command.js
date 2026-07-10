// Command — portfolio KPI row + parse sanity list. Every stat opens a modal.
import { fmtDate } from '../kernel/calendar.js';
import { openModal } from '../ui/modal.js';
import {
  esc, fmtMoney, fmtRatio, fmtPct, statTile, valueOrNA, naTag, countUp,
  statusPill, taskModalBody, taskLine, offenderListHTML,
} from '../ui/components.js';

export const ViewCommand = {
  id: 'command', title: 'Command', group: 'Overview',
  chip(store) {
    const m = store.model;
    return m ? `as of <span class="num">${fmtDate(m.dataDate)}</span>` : '';
  },
  render(el, store) {
    const m = store.model;
    const { evm, dcma, rollup } = store.d;
    const critical = m.tasks.filter((t) => t.totalFloatHrs !== undefined && t.totalFloatHrs <= 0 && t.status !== 'TK_Complete');
    const dcmaPass = dcma.filter((c) => c.status === 'pass').length;
    const dcmaNA = dcma.filter((c) => c.status === 'na').length;

    const spiTone = evm.spi.value === null ? '' : evm.spi.value >= 0.95 ? 'good' : evm.spi.value >= 0.85 ? 'warn' : 'bad';
    const cpiTone = evm.cpi.value === null ? '' : evm.cpi.value >= 0.95 ? 'good' : evm.cpi.value >= 0.85 ? 'warn' : 'bad';

    el.innerHTML = `
      <div class="banner">
        <b>${esc(store.modelName)}</b>
        <span>data date ${fmtDate(m.dataDate)} (from <span class="num">${esc(m.dataDateSource || 'n/a')}</span>)</span>
        <span>plan ${fmtDate(m.project.plan_start_date && m.tasks[0] ? m.tasks.reduce((a, t) => Math.min(a, t.targetStart ?? a), Infinity) : undefined)} → ${fmtDate(m.tasks.reduce((a, t) => Math.max(a, t.targetEnd ?? a), 0))}</span>
        ${store.baseline ? `<span>baseline <b>${esc(store.baselineName)}</b></span>` : `<span>${naTag('no baseline loaded — compare & 3 DCMA checks unavailable')}</span>`}
      </div>

      <div class="section">
        <h2>Portfolio</h2>
        <p class="sub">Click any figure for its derivation.</p>
        <div class="statrow">
          ${statTile({ id: 'acts', label: 'Activities', value: '<span data-count="acts">0</span>', note: `${m.preds.length} relationships` })}
          ${statTile({ id: 'spi', label: 'SPI', value: valueOrNA(fmtRatio(evm.spi.value), evm.spi.reason), tone: spiTone, note: 'EV ÷ PV at data date' })}
          ${statTile({ id: 'cpi', label: 'CPI', value: valueOrNA(fmtRatio(evm.cpi.value), evm.cpi.reason), tone: cpiTone, note: 'EV ÷ AC' })}
          ${statTile({ id: 'earned', label: '% Earned', value: valueOrNA(fmtPct(evm.earnedPct), 'no costs in file'), note: `of ${fmtMoney(evm.bac)} BAC` })}
          ${statTile({ id: 'crit', label: 'Critical', value: `<span data-count="crit">0</span>`, note: 'float ≤ 0, incomplete', tone: critical.length ? 'bad' : 'good' })}
          ${statTile({ id: 'dcma', label: 'DCMA', value: `<span class="num">${dcmaPass}/${14 - dcmaNA}</span>`, note: dcmaNA ? `${dcmaNA} not computable` : 'all computable', tone: dcmaPass >= 10 ? 'good' : 'warn' })}
        </div>
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
      crit: () => openModal('Critical activities', 'total float ≤ 0, not complete', critical.length
        ? `<ul class="offender-list">${critical.map((t) => `<li>${esc(t.code)}</li>`).join('')}</ul>`
        : '<p>No activities with float ≤ 0.</p>'),
      dcma: () => openModal('DCMA 14-Point Assessment', `${dcmaPass} pass of ${14 - dcmaNA} computable`, `
        <div class="tablewrap"><table class="ledger"><tbody>
          ${dcma.map((c) => `<tr><td class="num">${c.id}</td><td>${esc(c.name)}</td><td>${statusPill(c.status)}</td></tr>`).join('')}
        </tbody></table></div>
        <p style="color:var(--dim);font-size:12.5px;margin-top:10px">Full detail on the Health view.</p>`),
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
