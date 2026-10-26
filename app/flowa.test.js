import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPins, recommend, compareRuns, defaultWeights, km, DEFAULT_WEIGHTS, discretionary } from './flowa.js';

const base = loadPins(JSON.parse(readFileSync(new URL('./data/pins.json', import.meta.url))));

const profile = (over = {}) => ({
  brand: { name: 'Test', industry: 'Eyewear', tier: 'Mid', products: '', investmentLakh: 30, minSqft: 300, maxSqft: 600, stores: ['560034', '560001'], ...over.brand },
  goals: { newStores: 5, timelineMonths: 12, states: ['Karnataka'], districts: [], area: 'Urban', income: 'Middle', priority: 'Brand presence', exclude: [], consider: [], ...over.goals },
  guardrails: { minDistanceKm: 3, ...over.guardrails },
  ...(over.weights ? { weights: over.weights } : {}),
});

test('PIN base layer: every row has a state and district; centroids are in India', () => {
  assert.ok(base.pins.length > 19000);
  for (const p of base.pins) {
    assert.ok(p.state && p.district, p.pin);
    if (p.lat !== null) assert.ok(p.lat > 6 && p.lat < 37.5 && p.lng > 68 && p.lng < 97.5, p.pin);
  }
  assert.equal(base.byPin.get('560034').district, 'Bengaluru Urban');
});

test('approved default weights add to 100; priorities keep the total', () => {
  assert.equal(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  for (const p of ['Speed', 'Profitability', 'Brand presence']) assert.equal(Object.values(defaultWeights(p)).reduce((a, b) => a + b, 0), 100);
});

test('guardrails: no pick in a store PIN, near a store, excluded, or near another pick', () => {
  const pr = profile({ goals: { exclude: ['560066', 'Mysuru'] }, guardrails: { minDistanceKm: 3 } });
  const r = recommend(base, pr);
  assert.equal(r.picks.length, 5);
  const stores = pr.brand.stores.map(p => base.byPin.get(p));
  for (const p of r.picks) {
    assert.ok(!pr.brand.stores.includes(p.pin));
    assert.notEqual(p.pin, '560066');
    assert.notEqual(p.district, 'Mysuru');
    for (const s of stores) assert.ok(km(p, s) >= 3, `${p.pin} too close to ${s.pin}`);
    for (const q of r.picks) if (q !== p) assert.ok(km(p, q) >= 3, `${p.pin} too close to pick ${q.pin}`);
    assert.equal(p.state, 'Karnataka');
  }
});

test('missing data is reported, never guessed: score uses only loaded factors', () => {
  const r = recommend(base, profile());
  const p = r.picks[0];
  for (const k of ['demand', 'spending', 'engel', 'competition', 'cost']) {
    const f = p.factors.find(x => x.key === k);
    assert.equal(f.available, false); assert.equal(f.value, null);
  }
  assert.equal(r.coverage, 0.2); // distance 15 (10 + 5 for Brand presence) + fit 5, of 100
  assert.ok(r.missing.some(m => /Census/.test(m)) && r.missing.some(m => /spending survey/.test(m)));
});

test('same result whatever the order of the PIN file', () => {
  const shuffled = { ...base, pins: [...base.pins].reverse() };
  const a = recommend(base, profile()), b = recommend(shuffled, profile());
  assert.deepEqual(a.picks.map(p => p.pin), b.picks.map(p => p.pin));
});

test("Engel's Law: a staples brand prefers higher food shares, a premium brand lower ones", () => {
  // Fixture figures for the test only (not real survey numbers).
  const hces = new Map([
    ['Karnataka|urban', { mpce: 8000, foodShare: 0.38, source: 'fixture' }], ['Karnataka|rural', { mpce: 5000, foodShare: 0.48, source: 'fixture' }],
  ]);
  const data = { census: null, hces, competition: null, rent: null };
  const only = { demand: 0, spending: 0, engel: 100, competition: 0, cost: 0, distance: 0, fit: 0 };
  const staples = recommend(base, profile({ brand: { industry: 'Grocery and staples', tier: 'Value', stores: [] }, goals: { area: 'Both' }, weights: only }), data);
  const premium = recommend(base, profile({ brand: { industry: 'Eyewear', tier: 'Premium', stores: [] }, goals: { area: 'Both' }, weights: only }), data);
  assert.ok(discretionary({ industry: 'Grocery and staples', tier: 'Value' }) < discretionary({ industry: 'Eyewear', tier: 'Premium' }));
  const urbanShare = r => r.picks.filter(p => p.urban >= 0.5).length / r.picks.length;
  assert.equal(urbanShare(staples), 0, 'staples picks are rural (higher food share)');
  assert.equal(urbanShare(premium), 1, 'premium picks are urban (lower food share)');
});

test('compare runs: inputs that changed, PINs that entered and left', () => {
  const a = { profile: profile(), result: recommend(base, profile()) };
  const pb = profile({ goals: { exclude: [a.result.picks[0].pin] } });
  const b = { profile: pb, result: recommend(base, pb) };
  const c = compareRuns(a, b);
  assert.deepEqual(c.inputs.map(x => x.field), ['goals.exclude']);
  assert.ok(c.left.some(x => x.pin === a.result.picks[0].pin && /Excluded/.test(x.why)));
  assert.equal(c.entered.length, c.left.length);
});

test('a PIN the brand is considering is scored and explained even outside the target states', () => {
  const r = recommend(base, profile({ goals: { consider: ['110001'] } }));
  assert.equal(r.considered.length, 1);
  assert.equal(r.considered[0].state, 'Delhi');
  assert.ok(r.considered[0].reason);
});

// ---------- Census 2011 ----------
import { loadCensus } from './flowa.js';
const censusJson = JSON.parse(readFileSync(new URL('./data/census.json', import.meta.url)));
const census = loadCensus(censusJson, base);
const withCensus = { census, hces: null, competition: null, rent: null };

test('census: India total matches the 2011 count; a district\'s PIN estimates add back to its households', () => {
  // Each 2011 district counted once (a split district can appear under several present-day names).
  const once = new Map(censusJson.rows.map(r => [`${r[0]}|${r[2]}`, r]));
  assert.ok([...once.values()].reduce((s, r) => s + r[7], 0) > 1.1e9);
  const k = 'Karnataka|Bengaluru Urban', d = censusJson.rows.find(r => `${r[0]}|${r[1]}` === k);
  const sum = base.pins.filter(p => `${p.state}|${p.district}` === k).reduce((s, p) => s + census.perPin.get(p.pin).households, 0);
  assert.ok(Math.abs(sum - d[4]) / d[4] < 0.01, `${sum} vs ${d[4]}`);
});

test('census: demand is loaded; a district created after 2011 is scored at the median and labelled', () => {
  const r = recommend(base, profile({ goals: { states: ['Karnataka'], area: 'Both', newStores: 10 } }), withCensus);
  const f = r.picks[0].factors.find(x => x.key === 'demand');
  assert.ok(f.available && f.value >= 0 && f.value <= 1 && /households/.test(f.why));
  assert.ok(!r.missing.some(m => /^Census population/.test(m)));
  const pin = base.pins.find(p => p.district === 'Vijaynagar' && p.lat !== null).pin; // created 2021 from Ballari
  const r2 = recommend(base, profile({ goals: { states: ['Karnataka'], consider: [pin] } }), withCensus);
  const g = r2.considered[0].factors.find(x => x.key === 'demand');
  assert.equal(g.available, false); assert.equal(g.imputed, true); assert.match(g.why, /median/);
});

test('census: with demand weighted alone, most top picks are in the state\'s largest district', () => {
  const only = { demand: 100, spending: 0, engel: 0, competition: 0, cost: 0, distance: 0, fit: 0 };
  const r = recommend(base, profile({ brand: { stores: [] }, goals: { states: ['Karnataka'], area: 'Both', newStores: 5 }, weights: only }), withCensus);
  assert.ok(r.picks.filter(p => p.district === 'Bengaluru Urban').length >= 4, r.picks.map(p => p.district).join(', '));
});
