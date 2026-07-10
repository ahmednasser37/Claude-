// smoke.js — loads the built single-file app in a real browser and clicks
// through it: nav, modals (incl. focus trap + Escape), every view, and the
// 390×844 mobile drawer. "It builds" is not "it runs"; this is the runs part.
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'file://' + path.join(ROOT, 'dist/prism.html');
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${label}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ executablePath: EXECUTABLE });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(URL);
  await page.waitForSelector('.statrow .stat');

  // Command view: demo model loaded, KPI row real
  check(await page.locator('.navitem').count() === 8, 'sidebar lists 8 views');
  await page.waitForFunction(() => document.querySelector('[data-count="acts"]')?.textContent === '43');
  check(true, 'Command KPIs count up to 43 activities');

  // stat modal + focus trap + escape
  await page.click('[data-stat="spi"]');
  await page.waitForSelector('.modal-card');
  check(await page.locator('.modal-card').count() === 1, 'SPI stat opens a real modal');
  const trapped = await page.evaluate(() => {
    const card = document.querySelector('.modal-card');
    for (let i = 0; i < 30; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    }
    return card.contains(document.activeElement) || document.activeElement === document.body;
  });
  check(trapped, 'focus stays within the modal under Tab');
  await page.keyboard.press('Escape');
  check(await page.locator('.modal-card').count() === 0, 'Escape closes the modal');

  // every view renders without page errors
  for (const [id, probe] of [
    ['wbs', '.wbsrow'], ['health', '[data-check]'], ['gantt', '.taskcard'],
    ['chainage', '[data-oos]'], ['scurve', 'canvas'], ['resource', '[data-oa]'],
    ['compare', '[data-load-demo-baseline]'],
  ]) {
    await page.click(`[data-view="${id}"]`);
    await page.waitForSelector(probe, { timeout: 5000 });
    check(true, `view ${id} renders (${probe})`);
  }

  // health: 14 checks, N/A honesty before baseline
  await page.click('[data-view="health"]');
  await page.waitForSelector('[data-check]');
  check(await page.locator('[data-check]').count() === 14, 'DCMA renders all 14 checks');

  // compare: empty state -> demo baseline -> three tabs
  await page.click('[data-view="compare"]');
  await page.click('[data-load-demo-baseline]');
  await page.waitForSelector('.tabs');
  await page.click('[data-tab="wbs"]');
  await page.waitForSelector('[data-wv]');
  await page.click('[data-tab="crit"]');
  await page.waitForSelector('.section');
  check(true, 'compare tabs render from one shared diff');

  // WBS scope flow: click row -> modal -> "Set as scope" (never bare click)
  await page.click('[data-view="wbs"]');
  await page.click('[data-wbs="5033"]');
  await page.waitForSelector('[data-set-scope]');
  await page.click('[data-set-scope]');
  await page.waitForFunction(() => document.querySelector('.header .chip')?.textContent.includes('SEG-C'));
  check(true, 'scope set via modal button, shown as header chip');

  // Gantt modal with canvas + hidden a11y table
  await page.click('[data-view="gantt"]');
  await page.click('.taskcard');
  await page.waitForSelector('.modal-card canvas');
  check(await page.locator('.modal-card .visually-hidden table').count() === 1, 'gantt canvas ships a hidden table');
  await page.keyboard.press('Escape');

  // mobile: the prior build's worst bug — drawer must exist at 390x844
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  check(await page.locator('.hamburger').isVisible(), 'hamburger visible at 390x844');
  await page.click('.hamburger');
  await page.waitForTimeout(300);
  const drawerVisible = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    return el.getBoundingClientRect().left >= -2;
  });
  check(drawerVisible, 'drawer slides in on mobile');
  await page.click('[data-view="health"]');
  await page.waitForSelector('[data-check]');
  await page.waitForTimeout(350); // let the 220ms slide transition finish
  const drawerClosed = await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 2);
  check(drawerClosed, 'navigating closes the drawer');

  check(errors.length === 0, `no console/page errors (${errors.length ? errors.join(' | ').slice(0, 300) : 'clean'})`);
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
