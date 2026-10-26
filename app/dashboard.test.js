import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWorkbook, decide, interpret, applyChanges, nextHolds, isWinner, STATUS } from './engine.js';
import { SAMPLE_SHEETS } from './sample.js';
import { overview, finding } from './dashboard.js';

const fixture = name => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}.json`, import.meta.url)));
const run = sheets => decide(readWorkbook(sheets));

for (const [label, sheets] of [['sample', SAMPLE_SHEETS], ['42-candidate kit', fixture('case1_test_candidates')]]) {
  test(`dashboard figures add up (${label})`, () => {
    const r = run(sheets), o = overview(r), ds = Object.values(r.decisions);
    assert.equal(o.total, ds.length);
    assert.equal(o.parts.reduce((s, p) => s + p.n, 0), o.total, 'every application in exactly one pipeline part');
    assert.equal(o.filled, ds.filter(isWinner).length, 'filled slots = winners');
    assert.equal(o.holdReasons.reduce((s, h) => s + h.n, 0), o.counts[STATUS.HOLD], 'hold reasons cover every hold');
    assert.equal(o.bins.reduce((s, b) => s + b.n, 0), o.scored, 'score bands cover every scored applicant');
    assert.equal(o.bins.reduce((s, b) => s + b.won, 0), ds.filter(isWinner).length, 'every winner is in a band');
    for (const c of o.cities) assert.ok(c.filled <= c.slots);
    // Cities on the map account for every slot.
    assert.equal(o.cities.reduce((s, c) => s + c.slots, 0), o.slots);
    // The queue has no duplicates and nothing withdrawn.
    assert.equal(new Set(o.queue.map(q => q.id)).size, o.queue.length);
    assert.ok(o.queue.every(q => q.status !== STATUS.WITHDRAWN));
    assert.ok(finding(o).length >= 1);
  });
}

test('the shuffled kit gives the same dashboard', () => {
  const a = overview(run(fixture('case1_test_candidates'))), b = overview(run(fixture('case1_test_candidates_SHUFFLED')));
  assert.deepEqual(a.counts, b.counts);
  assert.deepEqual(a.territories, b.territories);
  assert.deepEqual(a.queue.map(q => q.id), b.queue.map(q => q.id));
});

test('dashboard follows an applied change (APP-012 finds a ground-floor space)', () => {
  const wb = readWorkbook(SAMPLE_SHEETS);
  const s = { apps: wb.apps, territories: wb.territories, stores: wb.stores };
  const before = decide(s);
  const p = interpret('APP-012 has now found a ground-floor space', s.apps, before, s.territories);
  assert.equal(p.type, 'proposal');
  const after = decide({ ...s, apps: applyChanges(s.apps, p.target, p.changes) }, { held: nextHolds(before) });
  const o1 = overview(before), o2 = overview(after);
  assert.equal(after.decisions['APP-012'].status, STATUS.APPROVED);
  assert.equal(o2.counts[STATUS.APPROVED], o1.counts[STATUS.APPROVED] + 1);
  assert.ok(o2.onboarding.some(w => w.id === 'APP-012'));
});
