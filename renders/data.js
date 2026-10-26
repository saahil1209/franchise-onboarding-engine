// Shared data for the three dashboard renders: the real engine run on the 42-candidate test file.
// Every figure on the screens is computed here from the decisions, so the options show the same truth.
import { readWorkbook, decide, summaryFacts, STATUS, isWinner } from '../app/engine.js';

export const STATUSES = ['Approved', 'Brand review', 'Conditional', 'Waitlist', 'On hold', 'Not eligible'];
const byId = (a, b) => a.localeCompare(b, 'en', { numeric: true });

export async function load() {
  const sheets = await (await fetch(new URL('../tests/fixtures/case1_test_candidates.json', import.meta.url))).json();
  const wb = readWorkbook(sheets);
  const r = decide(wb);
  const ds = Object.values(r.decisions).sort((a, b) => byId(a.id, b.id));

  const counts = Object.fromEntries(STATUSES.map(s => [s, ds.filter(d => d.status === s).length]));
  const total = ds.length;
  console.assert(Object.values(counts).reduce((a, b) => a + b, 0) === total, 'statuses add up to applications');

  const territories = Object.values(r.territories).map(({ territory: t, winners, candidates, overlaps }) => {
    const w = winners.map(id => r.decisions[id]);
    const applicants = ds.filter(d => t.pins.includes(d.app.pin)).length;
    return {
      id: t.id, city: t.city, priority: t.priority, slots: t.slots, pins: t.pins, overlaps,
      approved: w.filter(d => d.status === STATUS.APPROVED).length,
      pending: w.filter(d => d.status !== STATUS.APPROVED).length, // Brand review or Conditional: slot held, not final
      winners: w.map(d => ({ id: d.id, name: d.app.name, status: d.status, score: d.score.total, pin: d.app.pin })),
      contenders: candidates.length, applicants,
    };
  }).sort((a, b) => byId(a.id, b.id));
  const slots = territories.reduce((s, t) => s + t.slots, 0);
  const filled = territories.reduce((s, t) => s + t.approved + t.pending, 0);
  console.assert(filled === counts['Approved'] + counts['Brand review'] + counts['Conditional'], 'filled slots = winners');

  const scored = ds.filter(d => d.score);
  const bins = [40, 50, 60, 70, 80, 90].map(lo => ({ label: `${lo}–${lo + 10}`, lo, n: scored.filter(d => d.score.total >= lo && d.score.total < lo + 10).length, won: scored.filter(d => d.score.total >= lo && d.score.total < lo + 10 && isWinner(d)).length }));
  console.assert(bins.reduce((s, b) => s + b.n, 0) === scored.length, 'score bins cover every scored applicant');

  const holdKinds = { missing: 'Missing answers', contradiction: 'Form and notes disagree', confirm: 'Value to confirm', duplicate: 'Likely duplicate' };
  const holds = ds.filter(d => d.status === STATUS.HOLD).map(d => {
    const first = d.issues[0];
    return { d, kind: first.field === 'duplicate' ? 'duplicate' : first.kind };
  });
  const holdReasons = Object.entries(holdKinds).map(([k, label]) => ({ label, value: holds.filter(h => h.kind === k).length })).filter(x => x.value).sort((a, b) => b.value - a.value);
  console.assert(holdReasons.reduce((s, x) => s + x.value, 0) === counts['On hold'], 'hold reasons add up');

  const waitKinds = { 'pin-store': 'PIN has a store', 'pin-applicant': 'PIN went to a higher rank', 'slots-full': 'Territory full', 'no-territory': 'No territory for the PIN', 'no-slots': 'Territory has 0 slots', 'launch-horizon': 'Launch over 12 months', held: 'Behind a held slot' };
  const waitReasons = Object.entries(waitKinds).map(([k, label]) => ({ label, value: ds.filter(d => d.status === STATUS.WAITLIST && d.reason === k).length })).filter(x => x.value).sort((a, b) => b.value - a.value);
  console.assert(waitReasons.reduce((s, x) => s + x.value, 0) === counts['Waitlist'], 'waitlist reasons add up');

  const cityNames = [...new Set(ds.map(d => d.app.city || d.app.cityRaw))];
  const cities = cityNames.map(c => ({ label: c, value: ds.filter(d => (d.app.city || d.app.cityRaw) === c).length, winners: ds.filter(d => (d.app.city || d.app.cityRaw) === c && isWinner(d)).length })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const languages = ['Kannada', 'English', 'Hindi'].map(l => ({ label: l, value: ds.filter(d => d.app.language === l).length }));

  const facts = summaryFacts(r, []);
  const fraud = ds.filter(d => d.review.some(x => x.kind === 'fraud'));
  const flagged = ds.filter(d => d.review.length);
  // The queue: what a person must act on, most urgent first.
  const urgency = d => d.review.some(x => x.kind === 'fraud') ? 0 : d.status === STATUS.REVIEW ? 1 : d.status === STATUS.CONDITIONAL ? 2 : d.status === STATUS.HOLD ? 3 : 4;
  const queue = ds.filter(d => d.status === STATUS.REVIEW || d.status === STATUS.CONDITIONAL || d.status === STATUS.HOLD || d.review.length)
    .sort((a, b) => urgency(a) - urgency(b) || byId(a.id, b.id))
    .map(d => ({
      id: d.id, name: d.app.name || '(name blank)', status: d.status, city: d.app.city || d.app.cityRaw, pin: d.app.pin || d.app.pinRaw,
      why: d.review[0]?.text || d.issues[0]?.text || d.headline,
      action: d.review.some(x => x.kind === 'fraud') ? 'Check payment' : d.status === STATUS.REVIEW ? 'Review flag' : d.status === STATUS.CONDITIONAL ? 'Chase site' : d.status === STATUS.HOLD ? 'Ask applicant' : 'Review flag',
      fraud: d.review.some(x => x.kind === 'fraud'),
    }));

  const winners = ds.filter(isWinner).sort((a, b) => b.score.total - a.score.total).map(d => ({ id: d.id, name: d.app.name, city: d.app.city, pin: d.app.pin, status: d.status, score: d.score.total, territory: d.territory, weeks: d.plan.weeks, track: d.plan.track?.[0], language: d.app.language, buddy: d.plan.buddy?.id }));

  return { file: 'case1_test_candidates.xlsx', total, counts, territories, slots, filled, bins, scored: scored.length, holdReasons, waitReasons, cities, languages, facts, fraud, flagged, queue, winners, stores: r.stores.length, storeList: r.stores, decisions: r.decisions };
}
