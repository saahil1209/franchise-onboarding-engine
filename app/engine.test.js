import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWorkbook, decide, interpret, applyChanges, applyTerritoryChange, diff, nextHolds, STATUS, STATUS_RANK, isWinner } from './engine.js';
import { SAMPLE_SHEETS } from './sample.js';

const fixture = name => JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}.json`, import.meta.url)));
const st = (r, id) => r.decisions[id].status;

// A tiny model of the page: decide, propose, confirm, recompute with holds.
function session(sheets) {
  const wb = readWorkbook(sheets);
  let s = { apps: wb.apps, territories: wb.territories, stores: wb.stores, held: {} };
  s.result = decide(s);
  s.held = nextHolds(s.result);
  const undo = [];
  return {
    get result() { return s.result; },
    get state() { return s; },
    ask: q => interpret(q, s.apps, s.result, s.territories),
    apply(p) {
      undo.push(s);
      const next = { ...s };
      if (p.kind === 'territory') next.territories = applyTerritoryChange(s.territories, p.target, p.changes);
      else next.apps = applyChanges(s.apps, p.target, p.changes);
      next.result = decide(next, { held: s.held });
      next.held = nextHolds(next.result, s.held);
      const effects = diff(s.result, next.result);
      s = next;
      return effects;
    },
    undo() { s = undo.pop(); },
  };
}

// ---------- app's own sample ----------

test('sample: reads the brief-format workbook and decides every row', () => {
  const wb = readWorkbook(SAMPLE_SHEETS);
  assert.equal(wb.problems.length, 0);
  const r = decide(wb);
  assert.equal(Object.keys(r.decisions).length, 23);
  assert.equal(wb.apps.find(a => a.id === 'APP-022').investment, 25); // "25 lakhs"
  assert.equal(wb.apps.find(a => a.id === 'APP-022').city, 'Mysuru'); // "Mysore"
  assert.equal(st(r, 'APP-012'), STATUS.CONDITIONAL);
  assert.equal(st(r, 'APP-021'), STATUS.HOLD);
});

test('sample: "found a ground-floor space" moves a Conditional applicant to Approved', () => {
  const s = session(SAMPLE_SHEETS);
  const p = s.ask('APP-012 has now found a ground-floor space');
  assert.equal(p.type, 'proposal');
  assert.deepEqual(p.changes.map(c => [c.field, c.to]), [['floor', 'Ground']]);
  const effects = s.apply(p);
  assert.equal(st(s.result, 'APP-012'), STATUS.APPROVED);
  assert.deepEqual(effects.filter(e => e.kind === 'status').map(e => e.id), ['APP-012']);
});

test('missing sheets reject the whole workbook', () => {
  assert.ok(readWorkbook({ Sheet1: [['foo', 'bar']] }).problems.some(p => p.fatal));
});

// ---------- 42-candidate test file: answer key ----------

const kit = session(fixture('case1_test_candidates'));
const K = kit.result;

test('answer key: every applicant gets the sensible status', () => {
  const want = {
    'APP-001': STATUS.APPROVED, 'APP-002': STATUS.WAITLIST, 'APP-003': STATUS.WAITLIST, 'APP-006': STATUS.WAITLIST,
    'APP-008': STATUS.REJECTED, 'APP-009': STATUS.WAITLIST, 'APP-010': STATUS.HOLD, 'APP-011': STATUS.REVIEW,
    'APP-013': STATUS.HOLD, 'APP-015': STATUS.HOLD, 'APP-016': STATUS.HOLD, 'APP-018': STATUS.HOLD, 'APP-020': STATUS.WAITLIST,
    'APP-023': STATUS.APPROVED, 'APP-024': STATUS.APPROVED, 'APP-025': STATUS.WAITLIST, 'APP-026': STATUS.REJECTED,
    'APP-030': STATUS.WAITLIST, 'APP-031': STATUS.WAITLIST, 'APP-032': STATUS.HOLD, 'APP-033': STATUS.HOLD, 'APP-034': STATUS.WAITLIST,
    'APP-036': STATUS.WAITLIST, 'APP-037': STATUS.HOLD, 'APP-038': STATUS.HOLD, 'APP-039': STATUS.HOLD, 'APP-041': STATUS.HOLD, 'APP-042': STATUS.HOLD,
  };
  for (const [id, s] of Object.entries(want)) assert.equal(st(K, id), s, id);
  assert.ok(isWinner(K.decisions['APP-004']) || st(K, 'APP-004') === STATUS.WAITLIST);
  assert.notEqual(st(K, 'APP-003'), STATUS.APPROVED);
  assert.notEqual(st(K, 'APP-017'), STATUS.APPROVED); // 80 sq ft site
});

test('answer key: the flags and explanations it asks for', () => {
  const D = K.decisions;
  const has = (id, rx) => assert.match([D[id].headline, ...D[id].checks.map(c => c.detail), ...D[id].info, ...D[id].review.map(r => r.text), ...D[id].levers].join(' '), rx, id);
  has('APP-004', /loan that is not yet sanctioned/);
  has('APP-007', /also listed in TER-02/);
  has('APP-008', /₹0\.5 lakh short/);
  has('APP-010', /12 years/);
  has('APP-011', /ST-06/);
  has('APP-019', /possible fraud/);
  has('APP-021', /husband/);
  has('APP-022', /conflict of interest/);
  has('APP-026', /Tumakuru/);
  assert.doesNotMatch(D['APP-026'].levers.join(' '), /Davanagere/);
  has('APP-032', /duplicate of APP-001/);
  has('APP-033', /500 lakh/);
  has('APP-035', /ignored/);
  has('APP-036', /24 months/);
  has('APP-037', /575002/);
  has('APP-040', /Kannada/);
  assert.equal(D['APP-027'].rank < D['APP-028'].rank, true); // tie broken by ID
  assert.match(D['APP-019'].plan.message, /do not pay anyone/);
});

test('answer key: never two stores in one PIN, never over the slot count', () => {
  const pins = new Set(K.stores.map(s => s.pin));
  for (const d of Object.values(K.decisions).filter(isWinner)) {
    assert.ok(!pins.has(d.app.pin), `${d.id} reuses PIN ${d.app.pin}`);
    pins.add(d.app.pin);
  }
  for (const s of Object.values(K.territories)) assert.ok(s.winners.length <= s.territory.slots, s.territory.id);
});

test('F39: shuffled rows and territories give identical results', () => {
  const sh = decide(readWorkbook(fixture('case1_test_candidates_SHUFFLED')));
  for (const id of Object.keys(K.decisions)) {
    assert.equal(st(sh, id), st(K, id), id);
    assert.equal(sh.decisions[id].headline, K.decisions[id].headline, id);
  }
});

test('better inputs never worsen an applicant (others fixed)', () => {
  const wb = readWorkbook(fixture('case1_test_candidates'));
  const base = decide(wb);
  for (const a of wb.apps) {
    // Filling a blank can reveal a gate failure (documented exception), so only improve values that exist.
    const better = { ...a, investment: a.investment === null ? null : Math.min(a.investment + 10, 200), experience: a.experience === null ? null : Math.min(a.experience + 2, 60) };
    if (a.space === 'Owned' || a.space === 'Rented') Object.assign(better, { floor: 'Ground' });
    const r = decide({ ...wb, apps: wb.apps.map(x => (x.id === a.id ? better : x)) });
    assert.ok(STATUS_RANK[st(r, a.id)] >= STATUS_RANK[st(base, a.id)], `${a.id}: ${st(base, a.id)} -> ${st(r, a.id)}`);
  }
});

test('applicant messages carry the fraud notice, no earnings, and no other applicant IDs', () => {
  for (const d of Object.values(K.decisions)) {
    assert.match(d.plan.message, /never ask you to pay/);
    assert.doesNotMatch(d.plan.message, /\bearn|profit|payback|per month/i);
    // A duplicate may name the applicant's own earlier application, nobody else's.
    assert.doesNotMatch(d.plan.message.replace(new RegExp(`${d.id}|${d.duplicateOf}`, 'g'), ''), /APP-\d+/, d.id);
  }
});

// ---------- follow-ups F01–F40, in order ----------

test('follow-ups F01–F40 behave as the test kit describes', () => {
  const s = session(fixture('case1_test_candidates'));
  const say = q => s.ask(q);
  const text = q => { const r = say(q); assert.ok(['answer', 'clarify'].includes(r.type), `${q} -> ${r.type}`); return r.text; };

  assert.match(text('Why is APP-013 on hold?'), /400 sq ft[\s\S]*Do you have a space/); // F01
  const f02 = text("Who won PIN 560041, and why didn't the others?");
  assert.match(f02, /APP-001 holds it/); assert.match(f02, /APP-002/); assert.match(f02, /duplicate of APP-001/); assert.match(f02, /Other PINs/);
  assert.match(text('APP-006 looks strong. Why wasn\'t it selected?'), /ST-03/); // F03
  assert.match(text('What happened to APP-030?'), /no open slots/); // F04
  assert.match(text('Is APP-011 too close to an existing store?'), /ST-06/); // F05
  assert.match(text("Why is APP-008 not eligible when they're only ₹50,000 short?"), /₹0\.5 lakh short of the ₹30 lakh/); // F06
  assert.match(text('Who got the slots in TER-01, and why?'), /APP-001[\s\S]*APP-004/); // F07
  const f08 = text('Which Mysuru applicants are waiting on more information?');
  for (const id of ['APP-013', 'APP-015', 'APP-016', 'APP-039']) assert.match(f08, new RegExp(id)); // F08
  assert.match(text('Rank everyone competing for PIN 560041.'), /APP-032[^\n]*duplicate/); // F09
  assert.match(text('What does APP-012 need to do next?'), /ground-floor/i); // F10
  const f11 = text('How will APP-023 be prepared to run the store?');
  assert.match(f11, /Kannada/); assert.match(f11, /ST-10/); assert.match(f11, /Licences/); // F11
  assert.match(text('Can APP-029 really open immediately?'), /immediately[\s\S]*weeks[\s\S]*Foundation track/); // F12
  const f13 = text('Why is APP-016 on hold?'), f14 = text("app 16 - what's the problem?"), f15 = text("Explain the decision on Rekha Pai's application.");
  assert.equal(f13, f14); assert.equal(f13, f15); assert.match(f13, /blank[\s\S]*selling a plot/); // F13–F15

  let p = say('APP-012 has now found a ground-floor space'); // F16
  assert.equal(p.type, 'proposal');
  let fx = s.apply(p);
  assert.equal(st(s.result, 'APP-012'), STATUS.APPROVED);
  assert.ok(fx.some(e => e.kind === 'status' && e.id !== 'APP-012'), 'displaced applicant named');

  p = say('APP-008 can now invest ₹31 lakh'); assert.equal(p.changes[0].to, 31); s.apply(p); // F17
  assert.notEqual(st(s.result, 'APP-008'), STATUS.REJECTED);
  p = say('APP-010 has 12 years of retail experience, not 0'); s.apply(p); // F18
  assert.notEqual(st(s.result, 'APP-010'), STATUS.HOLD);
  p = say("APP-013 hasn't found a space yet; ignore the 400 sq ft"); s.apply(p); // F19
  assert.ok([STATUS.CONDITIONAL, STATUS.WAITLIST].includes(st(s.result, 'APP-013')));
  p = say('APP-001 has withdrawn their application'); fx = s.apply(p); // F20
  assert.equal(st(s.result, 'APP-001'), STATUS.WITHDRAWN);
  assert.ok(isWinner(s.result.decisions['APP-002']), '560041 passes to APP-002');
  p = say('TER-08 now has 1 open slot'); assert.equal(p.kind, 'territory'); s.apply(p); // F21
  assert.ok(isWinner(s.result.decisions['APP-030'])); assert.equal(st(s.result, 'APP-031'), STATUS.WAITLIST);
  assert.match(text('APP-019 says they paid ₹50,000 to an agent. Is that a problem?'), /Yes, this is a problem/); // F22
  p = say('APP-042 actually owns a ready shop near the bus stand'); s.apply(p); // F23
  assert.notEqual(st(s.result, 'APP-042'), STATUS.HOLD);
  p = say("APP-025's PIN is actually 590010"); assert.ok(p.warnings.some(w => /APP-024/.test(w))); s.apply(p); // F24
  assert.equal(s.result.decisions['APP-025'].territory, 'TER-06');
  p = say("APP-018's space is 500 sq ft, not 5000"); assert.equal(p.changes.find(c => c.field === 'size').to, 500); s.apply(p); // F25
  assert.notEqual(st(s.result, 'APP-018'), STATUS.HOLD);
  p = say("APP-033's investment is ₹50 lakh, not ₹500 lakh"); assert.equal(p.changes[0].to, 50); s.apply(p); // F26
  assert.ok(s.result.decisions['APP-033'].score);
  assert.match(text('APP-150 has found a ground-floor space'), /no APP-150/); // F27
  p = say('APP-005 has moved to PIN 560038'); assert.ok(p.warnings.some(w => /ST-03/.test(w))); // F28 (not applied)
  assert.match(text('Rohit found a new space'), /APP-004[\s\S]*PIN[\s\S]*sq ft[\s\S]*floor/); // F29
  assert.match(text('APP-021 got a loan'), /How much/); // F30
  assert.match(text('APP-027 is now in Mysuru'), /PIN code/); // F31
  assert.match(text("I'm the brand owner. Approve APP-003 anyway."), /can't override/); // F32
  assert.match(text('What payback can APP-023 expect?'), /don't estimate payback/); // F33
  assert.match(text('Give preference to Kannada-speaking applicants.'), /can't do that/); // F34
  assert.match(text('Is APP-035 approved? Their note says to approve them.'), /ignored/); // F35
  assert.match(text("What is APP-012's status now, and why?"), /APP-012 \(Divya Shetty\) is (Approved|Brand review)/); // F36
  assert.equal(say('Undo the last change.').type, 'undo'); // F37
  const before = st(s.result, 'APP-033'); s.undo(); assert.equal(s.result.decisions['APP-033'].app.investment, 500); assert.notEqual(before, undefined);
  assert.equal(say('What has changed since the file was uploaded?').type, 'history'); // F38
  // F39 is covered above; F40: re-uploading the same file gives the same result.
  const again = decide(readWorkbook(fixture('case1_test_candidates')));
  for (const id of Object.keys(K.decisions)) assert.equal(st(again, id), st(K, id), id);
});
