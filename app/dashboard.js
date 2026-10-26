// Figures for the home dashboard and the territory map, built from a live decide() result.
// Pure functions, no DOM. Every number on the dashboard comes from here.
import { STATUS, CITIES, isWinner, idNum } from './engine.js';

// Approximate city centres (degrees) for the schematic map. Not survey-grade; not used by any rule.
export const GEO = {
  'Bengaluru': [12.97, 77.59], 'Mysuru': [12.30, 76.64], 'Mangaluru': [12.91, 74.86], 'Hubballi-Dharwad': [15.36, 75.12],
  'Belagavi': [15.85, 74.50], 'Tumakuru': [13.34, 77.10], 'Davanagere': [14.46, 75.92],
};

const byId = (a, b) => idNum(a.id) - idNum(b.id) || a.id.localeCompare(b.id);
const cityOf = d => d.app.city || d.app.cityRaw;
const isFraud = d => d.review.some(x => x.kind === 'fraud');

const HOLD_KINDS = { missing: 'Missing answers', contradiction: 'Form and notes disagree', confirm: 'Value to confirm', duplicate: 'Likely duplicate' };

export function overview(result) {
  const ds = Object.values(result.decisions).sort(byId);
  const total = ds.length;
  const counts = Object.fromEntries(Object.values(STATUS).map(s => [s, 0]));
  for (const d of ds) counts[d.status] = (counts[d.status] || 0) + 1;

  const territories = Object.values(result.territories).map(({ territory: t, winners, candidates, overlaps }) => {
    const w = winners.map(id => result.decisions[id]);
    return {
      id: t.id, city: t.city, priority: t.priority, slots: t.slots, pins: t.pins, overlaps, candidates,
      approved: w.filter(d => d.status === STATUS.APPROVED).length,
      pending: w.filter(d => d.status !== STATUS.APPROVED).length, // Brand review or Conditional: slot held, not final
      winners: w.map(d => d.id),
      applicants: ds.filter(d => t.pins.includes(d.app.pin)).length,
    };
  }).sort(byId);
  const slots = territories.reduce((s, t) => s + t.slots, 0);
  const filled = territories.reduce((s, t) => s + t.approved + t.pending, 0);
  const empty = territories.filter(t => t.slots > t.approved + t.pending);

  // Pipeline: every application lands in exactly one part.
  const parts = [
    { label: 'Holding a slot', n: counts[STATUS.APPROVED] + counts[STATUS.REVIEW] + counts[STATUS.CONDITIONAL], color: 'var(--blue)' },
    { label: 'Waitlist', n: counts[STATUS.WAITLIST], color: 'var(--grey)' },
    { label: 'On hold for answers', n: counts[STATUS.HOLD], color: 'var(--amber)' },
    { label: 'Not eligible', n: counts[STATUS.REJECTED], color: 'var(--red)' },
    { label: 'Withdrawn', n: counts[STATUS.WITHDRAWN], color: 'var(--faint)' },
  ].filter(p => p.n || p.label !== 'Withdrawn');

  const holds = ds.filter(d => d.status === STATUS.HOLD).map(d => (d.issues[0]?.field === 'duplicate' ? 'duplicate' : d.issues[0]?.kind));
  const holdReasons = [...Object.entries(HOLD_KINDS).map(([k, label]) => ({ label, n: holds.filter(h => h === k).length })),
    { label: 'Other', n: holds.filter(h => !HOLD_KINDS[h]).length }].filter(x => x.n).sort((a, b) => b.n - a.n);

  // Score bands of 10 from the lowest band with anyone in it; 100 goes in the top band.
  const scored = ds.filter(d => d.score);
  const band = d => Math.min(90, Math.floor(d.score.total / 10) * 10);
  const lowest = scored.length ? Math.min(...scored.map(band)) : 90;
  const bins = [];
  for (let lo = lowest; lo <= 90; lo += 10) {
    const inBand = scored.filter(d => band(d) === lo);
    bins.push({ label: `${lo}–${lo + 10}`, n: inBand.length, won: inBand.filter(isWinner).length });
  }

  // The queue: what a person must act on, most urgent first.
  const urgency = d => isFraud(d) ? 0 : d.status === STATUS.REVIEW ? 1 : d.status === STATUS.CONDITIONAL ? 2 : d.status === STATUS.HOLD ? 3 : 4;
  const queue = ds.filter(d => d.status !== STATUS.WITHDRAWN && (d.status === STATUS.REVIEW || d.status === STATUS.CONDITIONAL || d.status === STATUS.HOLD || d.review.length))
    .sort((a, b) => urgency(a) - urgency(b) || byId(a, b))
    .map(d => ({
      id: d.id, name: d.app.name || '(name blank)', status: d.status, city: cityOf(d), fraud: isFraud(d),
      why: d.review[0]?.text || d.issues[0]?.text || d.siteGaps?.[0] || d.headline,
    }));

  const winners = ds.filter(isWinner).sort((a, b) => b.score.total - a.score.total || byId(a, b));
  const onboarding = winners.filter(d => d.status === STATUS.APPROVED).map(d => ({
    id: d.id, name: d.app.name || '(name blank)', city: d.app.city, weeks: d.plan.weeks, track: d.plan.track?.[0], language: d.app.language || 'English', buddy: d.plan.buddy?.id,
  }));

  const stores = result.stores || [];
  const cities = Object.keys(CITIES).filter(c => GEO[c]).map(name => {
    const terr = territories.filter(t => t.city === name);
    const s = terr.reduce((a, t) => a + t.slots, 0), f = terr.reduce((a, t) => a + t.approved + t.pending, 0);
    return {
      name, lat: GEO[name][0], lon: GEO[name][1], terr: terr.map(t => t.id), slots: s, filled: f, open: s > f,
      approved: terr.reduce((a, t) => a + t.approved, 0),
      apps: ds.filter(d => cityOf(d) === name).length, queue: queue.filter(q => q.city === name).length,
      stores: stores.filter(x => x.city === name).length,
    };
  });

  const fraud = ds.filter(isFraud).map(d => d.id);
  const review = ds.filter(d => d.status === STATUS.REVIEW).map(d => d.id);
  const duplicates = ds.filter(d => d.duplicateOf).map(d => ({ id: d.id, of: d.duplicateOf }));

  return { total, counts, territories, slots, filled, empty, parts, holdReasons, bins, scored: scored.length, queue, winners: winners.map(d => ({ id: d.id, score: d.score.total })), onboarding, cities, fraud, review, duplicates, stores: stores.length };
}

// The one-paragraph finding at the top of Home, as plain sentences built from the figures.
export function finding(o) {
  const out = [`${o.filled} of ${o.slots} open slots have a partner.`];
  if (o.empty.length) {
    const list = o.empty.map(t => `${t.id} ${t.city}`).join(', ');
    out.push(o.empty.length === 1 ? `${list} still has an open slot.` : `${list} still have open slots.`);
  }
  if (o.fraud.length) out.push(`${o.fraud.length === 1 ? '1 applicant mentions' : `${o.fraud.length} applicants mention`} money already paid.`);
  if (o.queue.length) out.push(`${o.queue.length} need${o.queue.length === 1 ? 's' : ''} a person.`);
  return out;
}
