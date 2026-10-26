import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkbook, decide, interpret, applyChanges, diff, STATUS, STATUS_RANK } from './engine.js';
import { SAMPLE_SHEETS } from './sample.js';

const wb = readWorkbook(SAMPLE_SHEETS);
const run = apps => decide({ ...wb, apps });
const base = run(wb.apps);
const st = (r, id) => r.decisions[id].status;

test('reads the brief-format workbook and decides every row', () => {
  assert.equal(wb.problems.length, 0);
  assert.equal(wb.apps.length, 23);
  assert.equal(Object.keys(base.decisions).length, 23);
  assert.equal(wb.apps.find(a => a.id === 'APP-022').investment, 25); // "25 lakhs"
  assert.equal(wb.apps.find(a => a.id === 'APP-022').city, 'Mysuru'); // "Mysore"
});

test('never two stores in one PIN, never over the slot count', () => {
  const pins = new Set(wb.stores.map(s => s.pin));
  for (const d of Object.values(base.decisions)) {
    if (d.status !== STATUS.APPROVED && d.status !== STATUS.CONDITIONAL) continue;
    assert.ok(!pins.has(d.app.pin), `${d.id} reuses PIN ${d.app.pin}`);
    pins.add(d.app.pin);
  }
  for (const s of Object.values(base.territories)) assert.ok(s.winners.length <= s.territory.slots);
});

test('planted cases get the expected status', () => {
  const want = {
    'APP-004': STATUS.WAITLIST, // PIN has an existing store
    'APP-006': STATUS.REJECTED, // below Tier 2 minimum
    'APP-007': STATUS.HOLD, // blank investment, size with no space
    'APP-009': STATUS.WAITLIST, // same PIN as a higher-ranked applicant
    'APP-010': STATUS.HOLD, // 0 years experience but runs a shop
    'APP-012': STATUS.WAITLIST, // loses the only slot to APP-013
    'APP-013': STATUS.CONDITIONAL, // wins the slot, no site
    'APP-014': STATUS.WAITLIST, // no territory
    'APP-016': STATUS.WAITLIST, // territory has 0 slots
    'APP-018': STATUS.HOLD, // invalid PIN
    'APP-021': STATUS.HOLD, // notes contradict "Owned"
    'APP-023': STATUS.HOLD, // city-PIN mismatch
    'APP-002': STATUS.APPROVED,
  };
  for (const [id, s] of Object.entries(want)) assert.equal(st(base, id), s, id);
  assert.equal(base.decisions['APP-007'].questions.length, 2);
});

test('same result regardless of row order', () => {
  const shuffled = [...wb.apps].reverse();
  shuffled.push(shuffled.shift());
  const r = run(shuffled);
  for (const id of Object.keys(base.decisions)) assert.equal(st(r, id), st(base, id), id);
});

test('better inputs never worsen an applicant (others fixed)', () => {
  for (const a of wb.apps) {
    const better = { ...a, investment: (a.investment ?? 0) + 10, experience: (a.experience ?? 0) + 2 };
    if (a.space !== 'Not yet identified') Object.assign(better, { floor: 'Ground', size: Math.max(a.size ?? 0, 400) });
    const r = run(wb.apps.map(x => (x.id === a.id ? better : x)));
    assert.ok(STATUS_RANK[st(r, a.id)] >= STATUS_RANK[st(base, a.id)], `${a.id}: ${st(base, a.id)} -> ${st(r, a.id)}`);
  }
});

test('"why" answers name the status and first failed check', () => {
  const r = interpret('Why is APP-007 on hold?', wb.apps, base);
  assert.equal(r.type, 'answer');
  assert.match(r.text, /APP-007 is On hold/);
  assert.match(r.text, /Investment capacity is blank/);
  const n = interpret('What would APP-007 need to change to move forward?', wb.apps, base);
  assert.match(n.text, /How much can you invest/);
});

test('new fact changes the decision and names knock-on effects', () => {
  const p = interpret('APP-012 has now found a ground-floor space', wb.apps, base);
  assert.equal(p.type, 'proposal');
  assert.deepEqual(p.changes.map(c => [c.field, c.to]), [['floor', 'Ground']]);
  const after = run(applyChanges(wb.apps, p.app, p.changes));
  assert.equal(st(after, 'APP-012'), STATUS.APPROVED);
  assert.equal(st(after, 'APP-013'), STATUS.WAITLIST);
  assert.deepEqual(diff(base, after).map(c => c.id).sort(), ['APP-012', 'APP-013']);
});

test('unknown IDs and vague updates get a clarifying reply', () => {
  assert.equal(interpret('Why is APP-099 on hold?', wb.apps, base).type, 'clarify');
  assert.equal(interpret('Why is this one on hold?', wb.apps, base).type, 'clarify');
  assert.equal(interpret('APP-012 has some news', wb.apps, base).type, 'clarify');
});

test('missing sheets reject the whole workbook', () => {
  const r = readWorkbook({ Sheet1: [['foo', 'bar']] });
  assert.ok(r.problems.some(p => p.fatal));
});

test('every applicant message carries the fraud notice and no earnings figure', () => {
  for (const d of Object.values(base.decisions)) {
    assert.match(d.plan.message, /never ask you to pay/);
    assert.doesNotMatch(d.plan.message, /earn|profit|payback|per month/i);
  }
});
