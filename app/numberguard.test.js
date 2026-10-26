import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberGuard, numbersIn } from './numberguard.js';
import { explain } from './api/explain.js';
import { mockGemini } from './api/_gemini.js';
import evals from './prompts/explain-picks.v1.evals.json' with { type: 'json' };

const input = { picks: [{ pin: '560076', rank: 1, score: 91.67, confidence: 0.13, factors: [{ name: 'Distance', value: 0.83, note: 'Nearest own store PIN 560034 is 4.2 km away.' }] }], investmentLakh: 30, share: 0.47 };

test('numberGuard: normalised forms of input numbers pass', () => {
  for (const t of ['Score 91.67.', 'Score about 92.', '4.2 km from the store', 'PIN 560076', '₹30 lakh', '₹3,000,000', 'food is 47% of spending', 'rank 1', 'confidence 13%'])
    assert.ok(numberGuard(t, input).ok, t);
});

test('numberGuard: made-up numbers fail', () => {
  for (const t of ['Score 95.', 'about 5 km away', '₹40 lakh', '3 stores', 'food is 52%', 'sales of ₹2 lakh a month'])
    assert.equal(numberGuard(t, input).ok, false, t);
});

test('numberGuard ignores digits inside IDs and reads Indian separators', () => {
  assert.deepEqual(numbersIn('APP-012 and TER-01'), []);
  assert.equal(numbersIn('₹1,23,456')[0].value, 123456);
});

const body = { brand: { name: 'Test', industry: 'Eyewear', tier: 'Mid' }, picks: input.picks.map(p => ({ ...p, area: 'Bengaluru Urban, Karnataka' })), missing: ['Census population by district.'] };

test('explain: good answer passes through', async () => {
  const g = mockGemini([{ picks: [{ pin: '560076', reason: 'Bengaluru Urban scores 91.67; the nearest own store is 4.2 km away.' }], suggestions: ['Add Census population.'] }]);
  const r = await explain(body, g);
  assert.equal(r.status, 200); assert.equal(r.json.picks.length, 1); assert.equal(g.calls.length, 1);
});

test('explain: invented number is retried once, then dropped', async () => {
  const bad = { picks: [{ pin: '560076', reason: 'Expect 300 customers a day.' }], suggestions: [] };
  const g = mockGemini([bad, bad]);
  const r = await explain(body, g);
  assert.equal(g.calls.length, 2); assert.equal(r.json.picks.length, 0); assert.equal(r.json.rejected, 1);
});

test('explain: earnings talk is rejected; broken JSON falls back; unconfigured says so', async () => {
  const r1 = await explain(body, mockGemini([{ picks: [{ pin: '560076', reason: 'Strong revenue here.' }], suggestions: [] }]));
  assert.equal(r1.json.picks.length, 0);
  const r2 = await explain(body, mockGemini(['not json', 'still not json']));
  assert.equal(r2.status, 502);
  const r3 = await explain(body, { ready: false, missing: ['GEMINI_MODEL_FAST'] });
  assert.equal(r3.status, 503); assert.match(r3.json.error, /GEMINI_MODEL_FAST/);
});

test('prompt eval cases: expected verdicts hold for recorded outputs', () => {
  for (const c of evals.cases) assert.equal(numberGuard(c.output, c.input, c.allow || []).ok, c.expectPass, c.name);
});
