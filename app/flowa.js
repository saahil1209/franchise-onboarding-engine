// Flow A: recommend, then refine (SPEC §3, §4, §7). Pure functions, no DOM.
// The engine scores candidate PINs for a brand profile. Every factor is 0–1 with its source, level and confidence;
// a factor whose data isn't loaded is reported as missing, never guessed. Numbers come from here, not from Gemini.

// ---------- PIN base layer ----------
export function loadPins(json) {
  const pins = json.rows.map(([pin, s, district, lat, lng, offices, branch, head]) => ({
    pin, state: json.states[s], district, lat, lng, offices, branch, head: !!head,
    // Urbanisation proxy from the post-office mix: branch offices serve villages, head and sub offices serve towns.
    urban: offices ? +(1 - branch / offices).toFixed(3) : 0,
  }));
  return { pins, byPin: new Map(pins.map(p => [p.pin, p])), states: [...json.states].sort(), source: json.source };
}

export const km = (a, b) => {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// ---------- profile ----------
export const INDUSTRIES = {
  'Grocery and staples': 0.1, 'Pharmacy': 0.3, 'Quick-service restaurant': 0.5, 'Café and bakery': 0.7, 'Apparel': 0.7, 'Footwear': 0.6,
  'Eyewear': 0.8, 'Electronics': 0.8, 'Beauty and personal care': 0.7, 'Education and tutoring': 0.6, 'Other': 0.5,
};
export const TIERS = { Value: -0.2, Mid: 0, Premium: 0.2 };

// Approved default weights (docs/DESIGN.md). The brand can change them in Refine.
export const DEFAULT_WEIGHTS = { demand: 25, spending: 20, engel: 15, competition: 15, cost: 10, distance: 10, fit: 5 };
export const FACTOR_LABEL = { demand: 'Demand', spending: 'Consumer spending', engel: "Engel's Law fit", competition: 'Competition', cost: 'Cost', distance: 'Distance from own stores', fit: 'Brand fit' };
// Proposed: a priority nudges the defaults before the brand fine-tunes them.
const PRIORITY_SHIFT = { 'Profitability': { spending: 5, cost: 5, demand: -5, distance: -5 }, 'Brand presence': { demand: 5, distance: 5, cost: -5, engel: -5 }, 'Speed': {} };

export function defaultWeights(priority) {
  const w = { ...DEFAULT_WEIGHTS };
  for (const [k, v] of Object.entries(PRIORITY_SHIFT[priority] || {})) w[k] += v;
  return w;
}

export const parsePins = text => [...new Set(String(text || '').match(/\b\d{6}\b/g) || [])];

// ---------- data sources that are not loaded yet ----------
// Each loader returns null when its file is absent; the factor is then "not loaded".
// census: Map "state|district" -> { population, households, urbanShare, source }
// hces:   Map "state|rural" / "state|urban" -> { mpce, foodShare, source, round }
// competition: Map pin -> { count, radiusKm, source }
// rent: Map "state|district" -> { perSqft, source, estimate: true }
export const NO_DATA = { census: null, hces: null, competition: null, rent: null };

// ---------- factors ----------
const clamp = x => Math.max(0, Math.min(1, x));
const lerp = (lo, hi, v) => (hi > lo ? clamp((v - lo) / (hi - lo)) : 0.5);

// Discretionary index: 0 = staples, 1 = premium discretionary. Drives the Engel's Law fit.
export const discretionary = brand => clamp((INDUSTRIES[brand.industry] ?? 0.5) + (TIERS[brand.tier] ?? 0));

function ctxFor(cands, data) {
  const range = f => { const v = cands.map(f).filter(x => x !== null && x !== undefined); return v.length ? [Math.min(...v), Math.max(...v)] : null; };
  const sector = p => (p.urban >= 0.5 ? 'urban' : 'rural');
  const hcesOf = p => data.hces?.get(`${p.state}|${sector(p)}`) || null;
  const censusOf = p => data.census?.get(`${p.state}|${p.district}`) || null;
  return {
    hcesOf, censusOf, sector,
    mpce: range(p => hcesOf(p)?.mpce), food: range(p => hcesOf(p)?.foodShare),
    pop: range(p => censusOf(p)?.population), comp: range(p => data.competition?.get(p.pin)?.count),
    rent: range(p => data.rent?.get(`${p.state}|${p.district}`)?.perSqft),
  };
}

const missing = (key, need) => ({ key, available: false, value: null, why: `Not loaded yet: needs ${need}.` });

export function factors(p, profile, stores, ctx, data) {
  const out = [];
  // Demand: district population from the Census, shared across the district's PINs (a modelled estimate).
  const c = ctx.censusOf(p);
  out.push(c ? { key: 'demand', available: true, value: lerp(ctx.pop[0], ctx.pop[1], c.population), confidence: 0.5, level: 'District (PIN share estimated)', source: c.source, why: `District population ${c.population.toLocaleString('en-IN')}.` }
    : missing('demand', 'Census population by district'));

  // Consumer spending and Engel's Law fit: HCES by state × rural/urban, applied to the PIN by its sector.
  const h = ctx.hcesOf(p), d = discretionary(profile.brand);
  if (h) {
    const spend = lerp(ctx.mpce[0], ctx.mpce[1], h.mpce);
    out.push({ key: 'spending', available: true, value: spend, confidence: 0.6, level: 'State × rural/urban (applied to PIN)', source: h.source, why: `Average monthly spending per person ₹${h.mpce.toLocaleString('en-IN')} (${ctx.sector(p)} ${p.state}).` });
    const lowFood = 1 - lerp(ctx.food[0], ctx.food[1], h.foodShare);
    out.push({ key: 'engel', available: true, value: +(1 - Math.abs(d - lowFood)).toFixed(4), confidence: 0.6, level: 'State × rural/urban (applied to PIN)', source: h.source, why: `Food is ${(h.foodShare * 100).toFixed(1)}% of spending; this brand is ${d >= 0.6 ? 'discretionary, so lower food shares fit better' : d <= 0.35 ? 'staples, so higher food shares fit better' : 'mid-range'}.` });
  } else {
    out.push(missing('spending', "MoSPI's Household Consumption Expenditure Survey by state"));
    out.push(missing('engel', "MoSPI's Household Consumption Expenditure Survey food shares"));
  }

  // Competition: fewer same-category places nearby is better (counted from Places, never stored).
  const comp = data.competition?.get(p.pin);
  out.push(comp ? { key: 'competition', available: true, value: 1 - lerp(ctx.comp[0], ctx.comp[1], comp.count), confidence: 0.7, level: 'PIN', source: comp.source, why: `${comp.count} similar places within ${comp.radiusKm} km.` }
    : missing('competition', 'Google Places counts (needs a working Maps key)'));

  // Cost: lower rent is better.
  const rent = data.rent?.get(`${p.state}|${p.district}`);
  out.push(rent ? { key: 'cost', available: true, value: 1 - lerp(ctx.rent[0], ctx.rent[1], rent.perSqft), confidence: 0.4, level: 'District (estimate)', source: rent.source, why: `Rent about ₹${rent.perSqft}/sq ft a month (estimate).` }
    : missing('cost', 'rent data (brand-provided or a rent dataset)'));

  // Distance from the brand's own stores (cannibalisation). Open data, high confidence.
  const min = profile.guardrails.minDistanceKm;
  const near = nearestStore(p, stores);
  out.push({
    key: 'distance', available: true, confidence: 0.9, level: 'PIN centroid', source: 'All India Pincode Directory centroids',
    value: near ? +lerp(min, min * 3, near.km).toFixed(4) : 1,
    why: near ? `Nearest own store PIN ${near.store.pin} is ${near.km.toFixed(1)} km away.` : 'No existing stores to compete with.',
  });

  // Brand fit: urban/rural target against the PIN's post-office mix (a proxy, low confidence).
  const area = profile.goals.area;
  const fit = area === 'Urban' ? p.urban : area === 'Rural' ? 1 - p.urban : 1;
  out.push({ key: 'fit', available: true, value: +fit.toFixed(4), confidence: area === 'Both' ? 0.9 : 0.4, level: 'PIN (post-office proxy)', source: 'All India Pincode Directory office types', why: area === 'Both' ? 'Targets urban and rural customers.' : `Looks ${p.urban >= 0.5 ? 'urban' : 'rural'} (${Math.round(p.urban * 100)}% of its post offices are town offices); target is ${area.toLowerCase()}.` });
  return out;
}

function nearestStore(p, stores) {
  let best = null;
  for (const s of stores) { if (s.lat === null) continue; const d = km(p, s); if (!best || d < best.km) best = { store: s, km: d }; }
  return best;
}

// ---------- the run ----------
// profile: { brand: { name, industry, tier, products, investmentLakh, minSqft, maxSqft, stores: [pin] },
//            goals: { newStores, timelineMonths, states: [], districts: [], area, income, priority, exclude: [pin|district], consider: [pin] },
//            guardrails: { minDistanceKm }, weights }
export function recommend(base, profile, data = NO_DATA) {
  const weights = profile.weights || defaultWeights(profile.goals.priority);
  const stores = profile.brand.stores.map(pin => base.byPin.get(pin)).filter(Boolean);
  const unknownStores = profile.brand.stores.filter(pin => !base.byPin.has(pin));
  const storePins = new Set(stores.map(s => s.pin));
  const ex = new Set(profile.goals.exclude.map(x => String(x).toLowerCase()));
  const states = new Set(profile.goals.states), districts = new Set(profile.goals.districts.map(d => d.toLowerCase()));
  const consider = new Set(profile.goals.consider);
  const min = profile.guardrails.minDistanceKm;

  const inRegion = p => (!states.size || states.has(p.state)) && (!districts.size || districts.has(p.district.toLowerCase()));
  const cands = base.pins.filter(p => p.lat !== null && (inRegion(p) || consider.has(p.pin)));
  const ctx = ctxFor(cands, data);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  const scored = [];
  for (const p of cands) {
    // Guardrails: deterministic, recorded as the reason a PIN is not eligible.
    let blocked = null;
    if (storePins.has(p.pin)) blocked = 'The brand already has a store in this PIN (one store per PIN).';
    else if (ex.has(p.pin) || ex.has(p.district.toLowerCase())) blocked = 'Excluded by the brand.';
    else { const n = nearestStore(p, stores); if (n && n.km < min) blocked = `Within ${min} km of own store PIN ${n.store.pin} (${n.km.toFixed(1)} km).`; }
    const fs = factors(p, profile, stores, ctx, data);
    const used = fs.filter(f => f.available && weights[f.key] > 0);
    const wUsed = used.reduce((s, f) => s + weights[f.key], 0);
    const score = wUsed ? +(100 * used.reduce((s, f) => s + weights[f.key] * f.value, 0) / wUsed).toFixed(1) : 0;
    const coverage = total ? wUsed / total : 0;
    const confidence = +(coverage * (used.reduce((s, f) => s + f.confidence * weights[f.key], 0) / (wUsed || 1))).toFixed(2);
    scored.push({ pin: p.pin, district: p.district, state: p.state, lat: p.lat, lng: p.lng, urban: p.urban, score, coverage: +coverage.toFixed(2), confidence, factors: fs, blocked, considered: consider.has(p.pin) });
  }
  // Ranking: score, then PIN number, so the order never depends on input order.
  scored.sort((a, b) => b.score - a.score || a.pin.localeCompare(b.pin));

  // Picks: best first, skipping any PIN within the minimum distance of an earlier pick (no self-cannibalisation).
  const picks = [];
  for (const s of scored) {
    if (picks.length >= profile.goals.newStores) break;
    if (s.blocked) continue;
    const clash = picks.find(q => km(s, q) < min);
    if (clash) { s.blocked = `Within ${min} km of recommended PIN ${clash.pin}.`; continue; }
    picks.push(s);
  }
  picks.forEach((s, i) => { s.rank = i + 1; s.reason = reasonFor(s, weights); });
  // The 50 best-scoring PINs, eligible or not: the "next best" list and the record runs are compared on.
  const shortlist = scored.slice(0, 50).map(s => ({ pin: s.pin, district: s.district, state: s.state, score: s.score, blocked: s.blocked, rank: s.rank ?? null }));
  const considered = scored.filter(s => s.considered).map(s => ({ ...s, reason: s.blocked || reasonFor(s, weights), rankAll: scored.indexOf(s) + 1 }));

  return {
    at: new Date().toISOString(), weights, candidates: cands.length,
    // How many eligible PINs share the top score: when many tie, their order is only the PIN number.
    ties: picks.length ? scored.filter(s => !s.blocked && s.score === picks[0].score).length : 0,
    noCoordinates: base.pins.filter(p => p.lat === null && (inRegion(p) || consider.has(p.pin))).length, eligible: scored.filter(s => !s.blocked).length,
    picks, considered, shortlist, stores: stores.map(s => ({ pin: s.pin, district: s.district, state: s.state, lat: s.lat, lng: s.lng })), unknownStores,
    coverage: picks[0]?.coverage ?? (cands.length ? scored[0]?.coverage : 0),
    missing: whatsMissing(profile, data, stores, unknownStores),
  };
}

// A short reason from the factors that helped most. Plain text; numbers are the engine's.
export function reasonFor(s, weights) {
  const used = s.factors.filter(f => f.available && weights[f.key] > 0).sort((a, b) => weights[b.key] * b.value - weights[a.key] * a.value);
  const top = used.slice(0, 2).map(f => f.why.replace(/\.$/, '')).join('; ');
  return `${s.district}, ${s.state}: ${top}.`;
}

export function whatsMissing(profile, data, stores, unknownStores = []) {
  const out = [];
  if (!data.census) out.push('Census population by district, to estimate demand.');
  if (!data.hces) out.push("MoSPI's consumer spending survey by state, for spending level and the Engel's Law fit.");
  if (!data.competition) out.push('Competitor counts from Google Places (needs a working Maps key).');
  if (!data.rent) out.push('Rent figures for your target areas, to compare cost.');
  if (!stores.length) out.push('Your existing store PINs, to keep new stores away from them.');
  else out.push('Monthly sales of your existing stores, to sharpen demand estimates.');
  if (unknownStores.length) out.push(`Check these store PINs; they aren't in the PIN directory: ${unknownStores.join(', ')}.`);
  return out;
}

// ---------- runs ----------
// What changed between two runs: inputs and picks.
export function compareRuns(a, b) {
  const ra = new Map(a.result.picks.map(p => [p.pin, p])), rb = new Map(b.result.picks.map(p => [p.pin, p]));
  const entered = b.result.picks.filter(p => !ra.has(p.pin)).map(p => ({ pin: p.pin, district: p.district, rank: p.rank, score: p.score }));
  const left = a.result.picks.filter(p => !rb.has(p.pin)).map(p => {
    const now = b.result.considered.find(c => c.pin === p.pin) || b.result.shortlist.find(c => c.pin === p.pin);
    return { pin: p.pin, district: p.district, rank: p.rank, why: now?.blocked || 'Outranked by other PINs, or outside the new target area.' };
  });
  const moved = b.result.picks.filter(p => ra.has(p.pin) && ra.get(p.pin).rank !== p.rank).map(p => ({ pin: p.pin, from: ra.get(p.pin).rank, to: p.rank }));
  return { inputs: diffProfiles(a.profile, b.profile), entered, left, moved };
}

export function diffProfiles(a, b) {
  const out = [];
  const flat = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${pre}${k}.`) : [[`${pre}${k}`, v]]));
  const fa = new Map(flat(a)), fb = new Map(flat(b));
  for (const k of new Set([...fa.keys(), ...fb.keys()])) {
    const x = JSON.stringify(fa.get(k) ?? null), y = JSON.stringify(fb.get(k) ?? null);
    if (x !== y) out.push({ field: k, from: fa.get(k) ?? null, to: fb.get(k) ?? null });
  }
  return out;
}
