// app.js — the Store (the only thing that calls parseXER/buildModel), the
// shell (sidebar, header, drawer), and the hash router. Views subscribe to
// the store's change event; no view imports another view's state.
import { parseXER } from './kernel/xer-parser.js';
import { buildModel } from './kernel/model.js';
import { computeEVM } from './kernel/evm.js';
import { runAllChecks } from './kernel/dcma.js';
import { rollupWBS } from './kernel/wbs.js';
import { findOutOfSequence } from './kernel/chainage.js';
import { resourceDemand } from './kernel/resource.js';
import { compareModels } from './kernel/compare.js';
import { windowReport, buildLookahead, updateIntegrity, floatBands } from './kernel/period.js';
import { longestPath } from './kernel/cpm.js';
import { dayFloor, DAY_MS } from './kernel/calendar.js';
import { DEMO_XER, BASELINE_XER, DEMO_NAME, BASELINE_NAME } from './data/demo.js';
import { closeModal } from './ui/modal.js';
import { esc } from './ui/components.js';
import { ViewCommand } from './views/command.js';
import { ViewWBS } from './views/wbs.js';
import { ViewHealth } from './views/health.js';
import { ViewTimeline } from './views/timeline.js';
import { ViewReport } from './views/report.js';
import { ViewLookahead } from './views/lookahead.js';
import { ViewRegister } from './views/register.js';
import { ViewGantt } from './views/gantt.js';
import { ViewChainage } from './views/chainage.js';
import { ViewSCurve } from './views/scurve.js';
import { ViewResource } from './views/resource.js';
import { ViewCompare } from './views/compare.js';

const VIEWS = [ViewCommand, ViewWBS, ViewHealth,
  ViewTimeline, ViewReport, ViewLookahead, ViewRegister,
  ViewGantt, ViewChainage, ViewSCurve, ViewResource, ViewCompare];

export const store = {
  model: null, modelName: '', baseline: null, baselineName: '',
  scope: null, view: 'command',
  win: { from: 0, to: 0, preset: 'back4w' },
  tlFilter: null,
  d: {},
  listeners: new Set(),
  on(fn) { this.listeners.add(fn); },
  emit() { for (const fn of this.listeners) fn(); },
  set(patch) { Object.assign(this, patch); this.emit(); },

  recompute() {
    const m = this.model;
    if (!m) { this.d = {}; return; }
    this.d = {
      evm: computeEVM(m),
      dcma: runAllChecks(m, { baseline: this.baseline }),
      rollup: rollupWBS(m),
      oos: findOutOfSequence(m),
      demand: resourceDemand(m, 'week'),
      cmp: this.baseline ? compareModels(m, this.baseline) : null,
      report: windowReport(m, this.win.from, this.win.to),
      integrity: updateIntegrity(m),
      bands: floatBands(m),
      lpath: longestPath(m),
    };
  },

  // ---- shared reporting window ----
  planSpan() {
    let t0 = Infinity, t1 = 0;
    for (const t of this.model.tasks) {
      if (t.targetStart !== undefined) t0 = Math.min(t0, t.targetStart);
      if (t.targetEnd !== undefined) t1 = Math.max(t1, t.targetEnd);
      if (t.actEnd !== undefined) t1 = Math.max(t1, t.actEnd);
    }
    return [dayFloor(t0), dayFloor(t1)];
  },
  setWindow(from, to, preset = 'custom') {
    this.win = { from: dayFloor(from), to: dayFloor(to), preset };
    if (this.model) this.d.report = windowReport(this.model, this.win.from, this.win.to);
    this.emit();
  },
  setWindowPreset(preset) {
    const m = this.model;
    if (!m) return;
    const dd = dayFloor(m.dataDate ?? Date.now());
    const back = (days) => this.setWindow(dd - days * DAY_MS, dd, preset);
    const fwd = (days) => this.setWindow(dd + DAY_MS, dd + days * DAY_MS, preset);
    switch (preset) {
      case 'back1w': return back(7);
      case 'back2w': return back(14);
      case 'back4w': return back(28);
      case 'month': {
        const d = new Date(dd);
        return this.setWindow(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0), preset);
      }
      case 'next2w': return fwd(14);
      case 'next4w': return fwd(28);
      case 'next6w': return fwd(42);
      case 'full': {
        const [a, b] = this.planSpan();
        return this.setWindow(a, b, preset);
      }
    }
  },
  stepWindow(dir) {
    const len = this.win.to - this.win.from + DAY_MS;
    this.setWindow(this.win.from + dir * len, this.win.to + dir * len, 'custom');
  },
  getLookahead(from, to) {
    return buildLookahead(this.model, from, to);
  },

  loadCurrent(text, name) {
    this.model = buildModel(parseXER(text));
    this.modelName = name;
    this.scope = null;
    this.tlFilter = null;
    const dd = this.model.dataDate;
    if (dd !== undefined) this.win = { from: dayFloor(dd) - 28 * DAY_MS, to: dayFloor(dd), preset: 'back4w' };
    else { const [a, b] = this.planSpan(); this.win = { from: a, to: b, preset: 'full' }; }
    this.recompute();
    this.emit();
  },
  loadBaseline(text, name) {
    this.baseline = buildModel(parseXER(text));
    this.baselineName = name;
    this.recompute();
    this.emit();
  },
  useDemo() { this.loadCurrent(DEMO_XER, DEMO_NAME + ' (demo)'); },
  useDemoBaseline() { this.loadBaseline(BASELINE_XER, BASELINE_NAME + ' (demo)'); },

  pickFile(kind) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xer,text/plain';
    input.addEventListener('change', () => {
      const f = input.files[0];
      if (!f) return;
      f.text().then((text) => {
        try {
          kind === 'baseline' ? this.loadBaseline(text, f.name) : this.loadCurrent(text, f.name);
        } catch (err) {
          alert(`Could not parse ${f.name}: ${err.message}`);
        }
      });
    });
    input.click();
  },
};

// The drifting star field behind everything — pure decoration, drawn once
// (static) for reduced-motion users, and never load-bearing for layout.
function mountStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  let stars = [];
  const seed = (w, h) => {
    stars = [];
    const n = Math.round((w * h) / 11000);
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * w, y: Math.random() * h,
        r: 0.3 + Math.random() * 1.1,
        v: 0.008 + Math.random() * 0.03,       // drift px/frame (parallax by size)
        p: Math.random() * Math.PI * 2,         // twinkle phase
        hue: Math.random() < 0.12 ? '139,123,255' : Math.random() < 0.3 ? '110,231,226' : '223,231,242',
      });
    }
  };
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed(innerWidth, innerHeight);
  };
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let t = 0;
  const frame = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    t += 0.016;
    for (const s of stars) {
      if (!still) { s.x -= s.v * s.r; if (s.x < -2) s.x = innerWidth + 2; }
      const tw = still ? 0.75 : 0.55 + 0.45 * Math.sin(t * 0.8 + s.p);
      ctx.fillStyle = `rgba(${s.hue},${(0.5 * tw * s.r).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    if (!still) requestAnimationFrame(frame);
  };
  size();
  window.addEventListener('resize', size);
  frame();
}

function renderSidebar(shell) {
  const groups = [];
  for (const v of VIEWS) {
    let g = groups.find((x) => x.name === v.group);
    if (!g) { g = { name: v.group, views: [] }; groups.push(g); }
    g.views.push(v);
  }
  const nav = shell.querySelector('.sidebar');
  nav.innerHTML = `
    <div class="brand"><i></i><b>PRISM</b><span>DEEP FIELD</span></div>
    ${groups.map((g) => `
      <div class="navgroup">
        <h3>${esc(g.name)}</h3>
        <div class="navlist">
          <span class="nav-indicator"></span>
          ${g.views.map((v) => `<button class="navitem" data-view="${v.id}">${esc(v.title)}</button>`).join('')}
        </div>
      </div>`).join('')}`;
  nav.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    location.hash = '#/' + b.dataset.view;
    shell.classList.remove('drawer-open');
  }));
}

function syncNav(shell) {
  shell.querySelectorAll('.navlist').forEach((list) => {
    const ind = list.querySelector('.nav-indicator');
    const active = list.querySelector(`[data-view="${store.view}"]`);
    list.querySelectorAll('.navitem').forEach((b) => b.classList.toggle('active', b.dataset.view === store.view));
    if (active) {
      ind.style.opacity = '1';
      ind.style.top = active.offsetTop + 6 + 'px';
      ind.style.height = active.offsetHeight - 12 + 'px';
    } else {
      ind.style.opacity = '0';
    }
  });
}

function renderHeader(shell) {
  const view = VIEWS.find((v) => v.id === store.view) || VIEWS[0];
  const chip = store.model && view.chip ? view.chip(store) : '';
  shell.querySelector('.header').innerHTML = `
    <button class="hamburger" aria-label="Menu"><i></i><i></i><i></i></button>
    <div class="crumb">PRISM / ${esc(view.group)}<b>${esc(view.title)}</b></div>
    ${chip ? `<span class="chip">${chip}</span>` : ''}
    <span class="spacer"></span>
    <button class="btn small" data-act="baseline">Load baseline…</button>
    <button class="btn small primary" data-act="load">Load .xer…</button>`;
  shell.querySelector('.hamburger').addEventListener('click', () => shell.classList.toggle('drawer-open'));
  shell.querySelector('[data-act="load"]').addEventListener('click', () => store.pickFile('current'));
  shell.querySelector('[data-act="baseline"]').addEventListener('click', () => store.pickFile('baseline'));
}

function renderView(shell) {
  const el = shell.querySelector('.view');
  const view = VIEWS.find((v) => v.id === store.view) || VIEWS[0];
  el.classList.remove('view'); // retrigger settle animation
  void el.offsetWidth;
  el.classList.add('view');
  if (!store.model) {
    el.innerHTML = `<div class="empty" style="margin-top:40px">
      <h3>No schedule loaded</h3>
      <p>Load a Primavera P6 .xer export, or explore the bundled demo project.</p>
      <p style="margin-top:14px"><button class="btn" data-open>Load .xer…</button>
      <button class="btn primary" data-demo>Open demo project</button></p></div>`;
    el.querySelector('[data-demo]').addEventListener('click', () => store.useDemo());
    el.querySelector('[data-open]').addEventListener('click', () => store.pickFile('current'));
    return;
  }
  view.render(el, store);
}

export function boot(root = document.body) {
  root.innerHTML = `
    <canvas class="stars" aria-hidden="true"></canvas>
    <div class="shell">
      <button class="scrim" aria-label="Close menu" tabindex="-1"></button>
      <nav class="sidebar" aria-label="Views"></nav>
      <div class="main">
        <header class="header"></header>
        <main class="view"></main>
      </div>
    </div>`;
  const shell = root.querySelector('.shell');
  mountStarfield(root.querySelector('canvas.stars'));
  renderSidebar(shell);
  shell.querySelector('.scrim').addEventListener('click', () => shell.classList.remove('drawer-open'));

  const applyHash = () => {
    const id = (location.hash || '').replace(/^#\//, '') || 'command';
    if (VIEWS.some((v) => v.id === id)) store.view = id;
    closeModal();
    renderHeader(shell);
    renderView(shell);
    syncNav(shell);
  };
  window.addEventListener('hashchange', applyHash);
  store.on(() => { renderHeader(shell); renderView(shell); syncNav(shell); });

  store.useDemo(); // demo loads instantly; "Load .xer" replaces it
  applyHash();
}

boot();
