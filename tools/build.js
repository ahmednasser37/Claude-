// build.js — bundles the ES-module source into one self-contained HTML file.
// Deliberately naive: modules are concatenated in explicit dependency order
// with import lines dropped and `export ` prefixes stripped. This works
// because the codebase keeps every top-level identifier unique — a property
// the smoke test exercises by actually running the bundle in a browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ORDER = [
  'src/kernel/xer-parser.js',
  'src/kernel/calendar.js',
  'src/kernel/chainage.js',
  'src/kernel/model.js',
  'src/kernel/cpm.js',
  'src/kernel/evm.js',
  'src/kernel/wbs.js',
  'src/kernel/dcma.js',
  'src/kernel/resource.js',
  'src/kernel/compare.js',
  'src/kernel/period.js',
  'src/data/demo.js',
  'src/ui/modal.js',
  'src/ui/components.js',
  'src/views/command.js',
  'src/views/wbs.js',
  'src/views/health.js',
  'src/views/timeline.js',
  'src/views/report.js',
  'src/views/lookahead.js',
  'src/views/gantt.js',
  'src/views/chainage.js',
  'src/views/scurve.js',
  'src/views/resource.js',
  'src/views/compare.js',
  'src/app.js',
];

function stripModule(src, name) {
  const out = src
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];\s*$/mg, '') // single- and multi-line imports
    .replace(/^export\s*\{[^}]*\};?\s*$/mg, '')                   // bare re-exports
    .replace(/^export\s+(function|const|class|let|var)/mg, '$1');
  return `// ---- ${name} ----\n${out}`;
}

const js = ORDER.map((f) => stripModule(read(f), f)).join('\n\n');
const css = read('src/ui/tokens.css');

const inner = `
<title>PRISM — Field Ledger</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${css}
</style>
<div id="prism-root"></div>
<script>
(function(){
${js.replace(/^boot\(\);$/m, "boot(document.getElementById('prism-root'));")}
})();
</script>`;

const standalone = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8">${inner.split('<div id="prism-root"></div>')[0]}</head>
<body><div id="prism-root"></div>${inner.split('<div id="prism-root"></div>')[1]}</body>
</html>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/prism.html'), standalone);
fs.writeFileSync(path.join(ROOT, 'dist/prism-artifact.html'), inner);
console.log(`dist/prism.html ${(standalone.length / 1024).toFixed(0)} KiB · dist/prism-artifact.html ${(inner.length / 1024).toFixed(0)} KiB`);
