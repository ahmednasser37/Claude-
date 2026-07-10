// Activity codes, earned schedule, longest path, float erosion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseXER } from '../src/kernel/xer-parser.js';
import { buildModel } from '../src/kernel/model.js';
import { computeEVM } from '../src/kernel/evm.js';
import { longestPath } from '../src/kernel/cpm.js';
import { compareModels } from '../src/kernel/compare.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const m = buildModel(parseXER(read('tests/fixtures/najd-s2-update.xer')));
const baseline = buildModel(parseXER(read('tests/fixtures/najd-s2-baseline.xer')));

test('activity codes: ACTVTYPE/ACTVCODE/TASKACTV parsed and joined', () => {
  assert.equal(m.codeTypes.size, 2);
  const names = [...m.codeTypes.values()].map((t) => t.name).sort();
  assert.deepEqual(names, ['AREA', 'PHASE']);
  const t = m.taskByCode.get('S31-030');
  const area = t.codes.find((c) => c.type.name === 'AREA');
  assert.equal(area.value.name, 'North Spread');
  const hdd = m.taskByCode.get('C-010');
  assert.equal(hdd.codes.find((c) => c.type.name === 'AREA').value.name, 'Crossings');
  assert.equal(m.taskByCode.get('P-010').codes.find((c) => c.type.name === 'PHASE').value.shortName, 'EP');
  // every activity in the fixture carries both codes
  for (const task of m.tasks) assert.equal(task.codes.length, 2);
});

test('earned schedule: SPI(t) is behind and does not fake N/A', () => {
  const evm = computeEVM(m);
  assert.notEqual(evm.es.value, null);
  // behind schedule: ES < AT, SV(t) negative, SPI(t) in a sane band
  assert.ok(evm.es.es < evm.es.at);
  assert.ok(evm.es.svt < 0);
  assert.ok(evm.es.value > 0.5 && evm.es.value < 1);
  assert.equal(evm.es.unit, 'months');
  // ES definition: cumulative PV at floor(ES) <= EV <= cumulative PV at ceil(ES)
  const n = Math.floor(evm.es.es);
  const lo = n === 0 ? 0 : evm.pv[n - 1].cum;
  assert.ok(lo <= evm.ev + 1e-6);
  assert.ok(evm.ev <= evm.pv[Math.min(n, evm.pv.length - 1)].cum + 1e-6);
});

test('longest path: a connected driving chain from a start node to project finish', () => {
  const lp = longestPath(m);
  assert.equal(lp.cyclic, false);
  assert.ok(lp.path.length >= 5);
  const codes = lp.path.map((id) => m.taskById.get(id).code);
  assert.equal(codes[0], 'A-000');            // starts at the NTP milestone
  assert.equal(codes[codes.length - 1], 'M-110'); // ends at handover
  // every consecutive pair is an actual relationship in the file
  const relSet = new Set(m.preds.map((p) => `${p.predTaskId}>${p.taskId}`));
  for (let i = 0; i < lp.path.length - 1; i++) {
    assert.ok(relSet.has(`${lp.path[i]}>${lp.path[i + 1]}`),
      `${codes[i]} -> ${codes[i + 1]} is not a relationship`);
  }
});

test('float erosion: ΔTF computed only where both files carry float', () => {
  const cmp = compareModels(m, baseline);
  const s34 = cmp.matched.find((x) => x.code === 'S34-050');
  // current -40h (-5 wd) vs baseline 80h (10 wd): 15 wd of float consumed
  assert.equal(s34.floatDelta, -15);
  // completed activities have no float in the current file -> undefined, not 0
  const done = cmp.matched.find((x) => x.code === 'S31-030');
  assert.equal(done.floatDelta, undefined);
});
