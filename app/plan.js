// Step 1: the brand profile, recommendations, refine, and saved runs (Flow A). The engine is flowa.js.
import { loadPins, recommend, compareRuns, defaultWeights, parsePins, INDUSTRIES, TIERS, FACTOR_LABEL, NO_DATA } from './flowa.js';
import { mountPinMap } from './pinmap.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'franchise-plan-v1';
const list = s => String(s || '').split(/[,\n;]+/).map(x => x.trim()).filter(Boolean);
const pct = x => `${Math.round(x * 100)}%`;
const time = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

let base = null, baseLoading = null;
let P = { runs: [], current: null, editing: true, compare: [] }; // runs: [{ id, at, note, profile, result, ai }]
let selectedPin = null, map = null, go = () => {};

const run = () => P.runs.find(r => r.id === P.current);
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(P)); } catch { /* the plan still works in this tab */ } }
try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (s?.runs) P = { compare: [], ...s }; } catch { /* start fresh */ }

async function pins() {
  if (base) return base;
  baseLoading ||= fetch('data/pins.json').then(r => { if (!r.ok) throw new Error('PIN data missing'); return r.json(); }).then(j => (base = loadPins(j)));
  return baseLoading;
}

export function initPlan(opts) {
  go = opts.go;
  map = mountPinMap($('pin-map'), { onPick: pin => { selectedPin = pin; renderResults(); } });
  $('plan-edit').addEventListener('click', () => { P.editing = true; save(); renderPlan(); });
  $('plan-continue').addEventListener('click', () => go('#home'));
  $('profile').addEventListener('submit', onProfile);
  $('profile').addEventListener('change', e => { if (e.target.name === 'anywhere') syncAnywhere(); });
  $('refine').addEventListener('submit', onRefine);
  $('refine').addEventListener('input', e => { if (e.target.type === 'range') e.target.nextElementSibling.textContent = e.target.value; });
  const pick = e => { const li = e.target.closest('[data-pin]'); if (li) { selectedPin = li.dataset.pin; renderResults(); $('pick-detail').scrollIntoView({ block: 'nearest' }); } };
  $('picks').addEventListener('click', pick);
  $('picks').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
  $('profile-cancel').addEventListener('click', () => { P.editing = false; $('profile').dataset.filled = ''; save(); renderPlan(); });
  $('runs').addEventListener('click', onRuns);
}

export const hasPlan = () => !!run();

export async function renderPlan() {
  const editing = P.editing || !run();
  $('plan-form-card').classList.toggle('hidden', !editing);
  $('profile-cancel').classList.toggle('hidden', !run());
  document.querySelectorAll('.plan-results').forEach(el => el.classList.toggle('hidden', editing));
  try { await pins(); } catch { $('profile-status').textContent = "The PIN data didn't load. Refresh to try again."; return; }
  if (editing) renderForm(); else renderResults();
}

// ---------- profile form ----------
const v = (f, n) => f.elements[n]?.value ?? '';
function renderForm() {
  const f = $('profile'), p = run()?.profile;
  if (!f.dataset.built) {
    f.elements.industry.innerHTML = Object.keys(INDUSTRIES).map(i => `<option>${esc(i)}</option>`).join('');
    $('states').innerHTML = base.states.map(s => `<label class="check"><input type="checkbox" name="state" value="${esc(s)}"> ${esc(s)}</label>`).join('');
    f.dataset.built = '1';
  }
  if (p && !f.dataset.filled) {
    const set = (n, x) => { if (f.elements[n]) f.elements[n].value = x ?? ''; };
    set('name', p.brand.name); set('industry', p.brand.industry); set('tier', p.brand.tier); set('products', p.brand.products);
    set('investment', p.brand.investmentLakh); set('minSqft', p.brand.minSqft); set('maxSqft', p.brand.maxSqft); set('stores', p.brand.stores.join(', '));
    set('newStores', p.goals.newStores); set('timeline', p.goals.timelineMonths); set('districts', p.goals.districts.join(', '));
    set('income', p.goals.income); set('priority', p.goals.priority); set('exclude', p.goals.exclude.join(', ')); set('minDistance', p.guardrails.minDistanceKm);
    f.querySelectorAll('input[name=area]').forEach(r => { r.checked = r.value === p.goals.area; });
    f.querySelectorAll('input[name=state]').forEach(c => { c.checked = p.goals.states.includes(c.value); });
    f.elements.anywhere.checked = !p.goals.states.length;
    f.dataset.filled = '1';
  }
  syncAnywhere();
}
function syncAnywhere() {
  const f = $('profile'), any = f.elements.anywhere.checked;
  f.querySelectorAll('input[name=state]').forEach(c => { c.disabled = any; });
  $('states').classList.toggle('off', any);
}

function readProfile(f) {
  const n = (name, d) => { const x = Number(v(f, name)); return Number.isFinite(x) && v(f, name) !== '' ? x : d; };
  const any = f.elements.anywhere.checked;
  const p = {
    brand: { name: v(f, 'name').trim(), industry: v(f, 'industry'), tier: v(f, 'tier'), products: v(f, 'products').trim(), investmentLakh: n('investment', null), minSqft: n('minSqft', null), maxSqft: n('maxSqft', null), stores: parsePins(v(f, 'stores')) },
    goals: {
      newStores: Math.max(1, Math.min(50, Math.round(n('newStores', 5)))), timelineMonths: n('timeline', 12),
      states: any ? [] : [...f.querySelectorAll('input[name=state]:checked')].map(c => c.value), districts: list(v(f, 'districts')),
      area: f.querySelector('input[name=area]:checked')?.value || 'Both', income: v(f, 'income'), priority: v(f, 'priority'),
      exclude: list(v(f, 'exclude')), consider: run()?.profile.goals.consider || [],
    },
    guardrails: { minDistanceKm: Math.max(0, n('minDistance', 2)) },
  };
  p.weights = run()?.profile.weights && run().profile.goals.priority === p.goals.priority ? run().profile.weights : defaultWeights(p.goals.priority);
  return p;
}

function onProfile(e) {
  e.preventDefault();
  const p = readProfile(e.target);
  const problems = [];
  if (!p.brand.name) problems.push('Add the brand name.');
  if (!e.target.elements.anywhere.checked && !p.goals.states.length) problems.push('Pick at least one state, or tick "Anywhere in India".');
  $('profile-status').textContent = problems.join(' ');
  if (problems.length) return;
  addRun(p, P.runs.length ? 'Profile edited' : 'First recommendation');
}

// ---------- runs ----------
function addRun(profile, note) {
  const result = recommend(base, profile, NO_DATA);
  const r = { id: `run-${P.runs.length + 1}`, at: result.at, note, profile, result, ai: null };
  P.runs.push(r); P.current = r.id; P.editing = false; selectedPin = result.picks[0]?.pin || null;
  $('profile').dataset.filled = '';
  save(); renderPlan(); scrollTo({ top: 0 });
  explain(r);
}

async function explain(r) {
  const res = r.result;
  if (!res.picks.length) return;
  const body = {
    brand: { name: r.profile.brand.name, industry: r.profile.brand.industry, tier: r.profile.brand.tier },
    picks: res.picks.slice(0, 10).map(p => ({ pin: p.pin, rank: p.rank, area: `${p.district}, ${p.state}`, score: p.score, confidence: p.confidence,
      factors: p.factors.map(f => ({ name: FACTOR_LABEL[f.key], value: f.available ? +(f.value * 100).toFixed(0) : null, note: f.why })) })),
    missing: res.missing,
  };
  try {
    const resp = await fetch('api/explain', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await resp.json().catch(() => null);
    r.ai = resp.ok && j ? { model: j.model, prompt: j.prompt, reasons: Object.fromEntries(j.picks.map(p => [p.pin, p.reason])), suggestions: j.suggestions } : { error: j?.error || null };
  } catch { r.ai = { error: null }; }
  save();
  if (P.current === r.id && !P.editing) renderResults();
}

function onRefine(e) {
  e.preventDefault();
  const f = e.target, cur = run().profile;
  const p = structuredClone(cur);
  const add = (arr, xs) => [...new Set([...arr, ...xs])];
  p.goals.exclude = add(p.goals.exclude, list(v(f, 'exclude')));
  p.goals.consider = add(p.goals.consider, parsePins(v(f, 'consider')));
  const n = Number(v(f, 'newStores')); if (n >= 1) p.goals.newStores = Math.min(50, Math.round(n));
  const d = Number(v(f, 'minDistance')); if (v(f, 'minDistance') !== '' && d >= 0) p.guardrails.minDistanceKm = d;
  p.goals.area = f.querySelector('input[name=rarea]:checked')?.value || p.goals.area;
  p.weights = Object.fromEntries(Object.keys(FACTOR_LABEL).map(k => [k, Number(f.elements[`w-${k}`].value)]));
  const note = v(f, 'note').trim() || 'Refined';
  f.elements.exclude.value = ''; f.elements.consider.value = ''; f.elements.note.value = '';
  addRun(p, note);
}

function onRuns(e) {
  const b = e.target.closest('button[data-run]');
  if (b) { P.current = b.dataset.run; selectedPin = run().result.picks[0]?.pin || null; save(); renderResults(); return; }
  const c = e.target.closest('input[data-cmp]');
  if (c) {
    P.compare = c.checked ? [...P.compare.filter(x => x !== c.dataset.cmp), c.dataset.cmp].slice(-2) : P.compare.filter(x => x !== c.dataset.cmp);
    save(); renderRuns();
  }
  const x = e.target.closest('button[data-unexclude]');
  if (x) { const p = structuredClone(run().profile); p.goals.exclude = p.goals.exclude.filter(v => v !== x.dataset.unexclude); addRun(p, `Removed exclusion ${x.dataset.unexclude}`); }
}

// ---------- results ----------
function renderResults() {
  const r = run(); if (!r) return;
  const res = r.result, p = r.profile;
  const where = p.goals.states.length ? p.goals.states.join(', ') : 'all of India';
  $('plan-title').textContent = `${p.brand.name}: where to open`;
  $('plan-meta').textContent = `${r.note} · ${time(r.at)} · ${p.brand.industry}, ${p.brand.tier.toLowerCase()} price tier`;
  const off = (res.picks[0] || res.considered[0])?.factors.filter(f => !f.available).map(f => FACTOR_LABEL[f.key]) || [];
  $('plan-summary').innerHTML = `${res.picks.length} recommended PIN${res.picks.length === 1 ? '' : 's'} in ${esc(where)}, from ${res.eligible.toLocaleString('en-IN')} eligible of ${res.candidates.toLocaleString('en-IN')} PINs. <b>Scored on ${pct(res.coverage)} of the factor weight.</b>${off.length ? ` Not loaded yet: ${esc(off.join(', '))}. Until they are, the picks rest on the factors that are loaded.` : ''}${res.ties > res.picks.length ? ` <b>${res.ties.toLocaleString('en-IN')} PINs tie on the top score</b>, so the order among them is only by PIN number; loading more data will separate them.` : ''}${res.noCoordinates ? ` ${res.noCoordinates} PIN${res.noCoordinates === 1 ? ' has' : 's have'} no reliable location in the directory and ${res.noCoordinates === 1 ? 'is' : 'are'} left out.` : ''}`;

  if (!res.picks.some(x => x.pin === selectedPin) && !res.considered.some(x => x.pin === selectedPin)) selectedPin = res.picks[0]?.pin || null;
  const ai = r.ai?.reasons || {};
  $('picks').innerHTML = (res.picks.length ? res.picks.map(x => `
    <li data-pin="${x.pin}" class="${x.pin === selectedPin ? 'sel' : ''}" tabindex="0">
      <span class="rk">${x.rank}</span>
      <span class="who"><b>PIN ${x.pin}</b> · ${esc(x.district)}, ${esc(x.state)}</span>
      <span class="sc">${x.score}<small>/100</small></span>
      <span class="why">${esc(ai[x.pin] || x.reason)}</span>
      <span class="meta">${ai[x.pin] ? 'Written by Gemini, numbers checked against the engine · ' : ''}confidence ${pct(x.confidence)}</span>
    </li>`).join('') : '<li class="empty">No PIN passes the guardrails. Widen the area or lower the minimum distance.</li>')
    + res.considered.map(x => `
    <li data-pin="${x.pin}" class="consider ${x.pin === selectedPin ? 'sel' : ''}" tabindex="0">
      <span class="rk">+</span><span class="who"><b>PIN ${x.pin}</b> · ${esc(x.district)} <span class="tag review">You're considering</span></span>
      <span class="sc">${x.score}<small>/100</small></span><span class="why">${esc(x.blocked ? `Not recommended: ${x.blocked}` : `Ranks ${x.rankAll.toLocaleString('en-IN')} of ${res.candidates.toLocaleString('en-IN')}. ${x.reason}`)}</span>
    </li>`).join('');
  $('picks-n').textContent = `${res.picks.length} of ${p.goals.newStores} wanted`;

  const pts = [
    ...res.stores.map(s => ({ kind: 'store', pin: s.pin, lat: s.lat, lng: s.lng, title: `Your store, PIN ${s.pin} (${s.district})` })),
    ...res.considered.map(x => ({ kind: 'consider', pin: x.pin, lat: x.lat, lng: x.lng, label: '+', title: `Considering PIN ${x.pin}` })),
    ...res.picks.map(x => ({ kind: 'pick', pin: x.pin, lat: x.lat, lng: x.lng, label: String(x.rank), title: `#${x.rank} PIN ${x.pin}, ${x.district}: score ${x.score}` })),
  ];
  map.set(pts, p.guardrails.minDistanceKm, selectedPin);
  renderDetail(r); renderRefine(r); renderMissing(r); renderRuns();
}

function renderDetail(r) {
  const res = r.result, w = res.weights;
  const x = res.picks.find(q => q.pin === selectedPin) || res.considered.find(q => q.pin === selectedPin);
  if (!x) { $('pick-detail').innerHTML = '<p class="empty">Pick a PIN to see its score breakdown.</p>'; return; }
  $('pick-detail').innerHTML = `
    <header><h2>PIN ${x.pin} · ${esc(x.district)}</h2><span class="meta">${x.rank ? `rank ${x.rank}` : 'not in the picks'}</span></header>
    <p class="muted">${esc(x.state)} · score ${x.score} / 100 on the loaded factors · confidence ${pct(x.confidence)}${x.blocked ? ` · <b>${esc(x.blocked)}</b>` : ''}</p>
    <table class="data"><thead><tr><th>Factor</th><th>Weight</th><th style="width:28%">Value</th><th>Why · source</th></tr></thead><tbody>
    ${x.factors.map(f => `<tr class="${f.available ? '' : 'off'}"><td>${esc(FACTOR_LABEL[f.key])}</td><td class="n">${w[f.key]}</td>
      <td>${f.available ? `<div class="bar" role="img" aria-label="${Math.round(f.value * 100)} of 100"><i style="width:${f.value * 100}%"></i></div><span class="meta">${Math.round(f.value * 100)} · confidence ${pct(f.confidence)}</span>` : '<span class="meta">not loaded</span>'}</td>
      <td>${esc(f.why)}${f.available ? `<br><span class="meta">${esc(f.source)} · ${esc(f.level)}</span>` : ''}</td></tr>`).join('')}
    </tbody></table>
    <p class="meta" style="margin-top:8px">Scores are relative to the other candidate PINs in this run. The platform recommends; your team decides.</p>`;
}

function renderRefine(r) {
  const f = $('refine'), p = r.profile;
  f.elements.newStores.value = p.goals.newStores; f.elements.minDistance.value = p.guardrails.minDistanceKm;
  f.querySelectorAll('input[name=rarea]').forEach(x => { x.checked = x.value === p.goals.area; });
  $('weights').innerHTML = Object.entries(FACTOR_LABEL).map(([k, label]) => {
    const loaded = r.result.picks[0]?.factors.find(x => x.key === k)?.available ?? (k === 'distance' || k === 'fit');
    return `<label class="wt ${loaded ? '' : 'off'}"><span>${esc(label)}${loaded ? '' : ' <em>(not loaded)</em>'}</span><input type="range" name="w-${k}" min="0" max="50" step="5" value="${p.weights[k]}"><b>${p.weights[k]}</b></label>`;
  }).join('');
  $('excluded').innerHTML = p.goals.exclude.length ? `Excluded: ${p.goals.exclude.map(x => `<button type="button" class="chipx" data-unexclude="${esc(x)}" title="Remove this exclusion and re-run">${esc(x)} ×</button>`).join(' ')}` : '';
}

function renderMissing(r) {
  const ai = r.ai;
  $('missing').innerHTML = `<ul class="hist">${r.result.missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
    ${ai?.suggestions?.length ? `<h3 class="sub">Gemini suggests</h3><ul class="hist">${ai.suggestions.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    <p class="meta">${ai === null ? 'Asking Gemini to explain the picks…' : ai?.model ? `Explanations: ${esc(ai.model)} (${esc(ai.prompt)}), every number checked against the engine.` : ai?.error ? `Explanations from the engine's rules. ${esc(ai.error)}` : "Explanations from the engine's rules (Gemini isn't available here)."}</p>`;
}

function renderRuns() {
  $('runs').innerHTML = `<table class="data"><thead><tr><th>Compare</th><th>Run</th><th>What changed</th><th>Picks</th><th>Coverage</th><th></th></tr></thead><tbody>
    ${[...P.runs].reverse().map(r => `<tr class="${r.id === P.current ? 'sel' : ''}"><td><input type="checkbox" data-cmp="${r.id}" ${P.compare.includes(r.id) ? 'checked' : ''} aria-label="Compare ${r.id}"></td>
      <td>${esc(r.id.replace('run-', 'Run '))} · ${time(r.at)}</td><td>${esc(r.note)}</td><td class="n">${r.result.picks.length}</td><td class="n">${pct(r.result.coverage)}</td>
      <td>${r.id === P.current ? '<span class="meta">showing</span>' : `<button type="button" class="linkbtn" data-run="${r.id}">Show</button>`}</td></tr>`).join('')}
    </tbody></table>${compareHTML()}`;
}

function compareHTML() {
  if (P.compare.length !== 2) return '<p class="meta" style="margin-top:8px">Tick two runs to compare them.</p>';
  const [a, b] = P.compare.map(id => P.runs.find(r => r.id === id)).sort((x, y) => x.at.localeCompare(y.at));
  const c = compareRuns(a, b);
  const fmt = x => Array.isArray(x) ? (x.length ? x.join(', ') : 'none') : x === null ? '—' : String(x);
  return `<div class="cmp"><h3 class="sub">${esc(a.id.replace('run-', 'Run '))} → ${esc(b.id.replace('run-', 'Run '))}</h3>
    <p><b>Inputs changed:</b> ${c.inputs.length ? c.inputs.map(i => `${esc(i.field)}: ${esc(fmt(i.from))} → ${esc(fmt(i.to))}`).join('; ') : 'none'}</p>
    <p><b>New picks:</b> ${c.entered.length ? c.entered.map(x => `PIN ${x.pin} (${esc(x.district)}, #${x.rank})`).join(', ') : 'none'}</p>
    <p><b>Dropped:</b> ${c.left.length ? c.left.map(x => `PIN ${x.pin} (${esc(x.district)}): ${esc(x.why)}`).join('; ') : 'none'}</p>
    <p><b>Moved:</b> ${c.moved.length ? c.moved.map(x => `PIN ${x.pin} #${x.from} → #${x.to}`).join(', ') : 'none'}</p></div>`;
}

export function relayoutPlan() { map?.relayout(); }
