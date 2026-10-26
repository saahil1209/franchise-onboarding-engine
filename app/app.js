import { readWorkbook, decide, interpret, applyChanges, applyTerritoryChange, diff, why, nextHolds, summaryFacts, isWinner, CONFIG, FIELD_LABEL, STATUS_RANK, idNum } from './engine.js';
import { SAMPLE_SHEETS } from './sample.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = s => s.replace(/ /g, '-');
const chip = s => `<span class="chip s-${cls(s)}">${esc(s)}</span>`;
const show = v => (v === null || v === undefined || v === '' ? '—' : v);
const STORE_KEY = 'franchise-session-v2';

// All state lives in this tab (and its sessionStorage, so a refresh keeps it).
let S = null; // { name, apps, territories, stores, problems, held, history: [], undo: [] }
let result = null, selected = null, filter = null, pending = null;
let query = '', sortKey = 'id', sortAsc = true;

// Ascending status order follows the pipeline: furthest along first.
const STATUS_ORDER = ['Approved', 'Brand review', 'Conditional', 'Waitlist', 'On hold', 'Not eligible', 'Withdrawn'];
const SORTS = {
  id: d => idNum(d.id),
  name: d => d.app.name.toLowerCase() || null,
  place: d => `${d.app.city || d.app.cityRaw} ${d.app.pin || d.app.pinRaw}`.toLowerCase().trim() || null,
  status: d => STATUS_ORDER.indexOf(d.status),
  score: d => d.score ? d.score.total : null,
  reason: d => d.headline.toLowerCase(),
  language: d => (d.app.language || d.app.languageRaw).toLowerCase() || null,
};
function visibleRows(ds) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const get = SORTS[sortKey];
  return ds
    .filter(d => !filter || d.status === filter)
    .filter(d => {
      if (!words.length) return true;
      const a = d.app;
      const hay = [d.id, a.name, a.city, a.cityRaw, a.pin, a.pinRaw, d.status, d.headline, a.business, a.notes, a.language, d.territory].join(' ').toLowerCase();
      return words.every(w => hay.includes(w));
    })
    .sort((x, y) => {
      const p = get(x), q = get(y);
      if (p === null && q !== null) return 1; // blanks always last
      if (q === null && p !== null) return -1;
      const c = p < q ? -1 : p > q ? 1 : 0;
      return (sortAsc ? c : -c) || idNum(x.id) - idNum(y.id);
    });
}

const recompute = () => { result = decide(S, { held: S.held }); S.held = nextHolds(result, S.held); };
function save() {
  try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ S, chat: $('chat').innerHTML, selected })); } catch { /* storage full or blocked: the session still works, it just won't survive a refresh */ }
}

function load(sheets, name) {
  const r = readWorkbook(sheets);
  const fatal = r.problems.filter(p => p.fatal);
  showProblems(r.problems);
  if (fatal.length) { $('results').classList.add('hidden'); $('filename').textContent = `${name}: not processed`; return; }
  S = { name, apps: r.apps, territories: r.territories, stores: r.stores, problems: r.problems, held: {}, history: [{ when: new Date().toISOString(), kind: 'upload', text: `Processed ${name}.` }], undo: [] };
  selected = null; filter = null; pending = null;
  $('chat').innerHTML = '';
  recompute();
  render(); save();
}

function showProblems(problems) {
  $('problems').classList.toggle('hidden', !problems.length);
  $('problems').innerHTML = problems.map(p => `<li class="${p.fatal ? 'fatal' : 'muted'}">${esc(p.text)}</li>`).join('');
}

$('file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 5e6) { $('filename').textContent = 'File is over 5 MB; please upload the case workbook.'; return; }
  try {
    const book = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const sheets = Object.fromEntries(book.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1, defval: '', raw: true })]));
    load(sheets, f.name);
  } catch (err) {
    $('filename').textContent = `Couldn't read ${f.name}: ${err.message}`;
  }
  e.target.value = '';
});
$('sample').addEventListener('click', () => load(SAMPLE_SHEETS, 'Sample workbook'));
$('download-sample').addEventListener('click', () => {
  const book = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(SAMPLE_SHEETS)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), n);
  XLSX.writeFile(book, 'case1-sample.xlsx');
});
$('reset').addEventListener('click', () => {
  if (!confirm('Clear this session? The uploaded data, decisions, changes and chat will be removed from this tab.')) return;
  try { sessionStorage.removeItem(STORE_KEY); } catch { /* nothing stored */ }
  S = result = selected = filter = pending = null;
  $('chat').innerHTML = ''; $('filename').textContent = ''; showProblems([]);
  $('results').classList.add('hidden'); $('reset').classList.add('hidden');
});

function render() {
  $('results').classList.remove('hidden'); $('reset').classList.remove('hidden');
  $('filename').textContent = `${S.name}: ${S.apps.length} applications, ${S.territories.length} territories, ${S.stores.length} existing stores`;
  const ds = Object.values(result.decisions).sort((a, b) => idNum(a.id) - idNum(b.id) || a.id.localeCompare(b.id));
  const counts = {};
  for (const d of ds) counts[d.status] = (counts[d.status] || 0) + 1;
  $('counts').innerHTML = Object.keys(STATUS_RANK).reverse().filter(s => counts[s] || s !== 'Withdrawn').map(s =>
    `<button data-filter="${esc(s)}" aria-pressed="${filter === s}"><b>${counts[s] || 0}</b>${chip(s)}</button>`).join('');
  const rows = visibleRows(ds);
  $('shown').textContent = rows.length === ds.length ? `${ds.length} applications` : `Showing ${rows.length} of ${ds.length}`;
  $('sort').value = sortKey;
  $('sort-dir').textContent = sortAsc ? '↑ Ascending' : '↓ Descending';
  for (const th of $('apps-head').querySelectorAll('th')) th.setAttribute('aria-sort', th.dataset.sort === sortKey ? (sortAsc ? 'ascending' : 'descending') : 'none');
  $('apps').innerHTML = (rows.length ? '' : '<tr><td colspan="6" class="empty">No applications match.</td></tr>') + rows.map(d => `
    <tr tabindex="0" data-id="${esc(d.id)}" class="${d.id === selected ? 'sel' : ''}" aria-selected="${d.id === selected}">
      <td><b>${esc(d.id)}</b></td><td>${esc(d.app.name) || '<span class="muted">(blank)</span>'}</td>
      <td>${esc(d.app.city || d.app.cityRaw)} · ${esc(d.app.pin || d.app.pinRaw)}</td>
      <td>${chip(d.status)}${d.review.length && d.status !== 'Brand review' ? ' <span title="Has a flag for the brand" aria-label="flagged">⚑</span>' : ''}</td><td>${d.score ? d.score.total : '—'}</td><td>${esc(d.headline)}</td></tr>`).join('');
  $('terr').innerHTML = Object.values(result.territories).map(({ territory: t, winners, candidates, overlaps }) => `
    <tr><td><b>${esc(t.id)}</b></td><td>${esc(t.city)}</td><td>${esc(t.priority)}</td><td>${winners.length} / ${t.slots}</td>
    <td>${winners.map(id => `${esc(id)} ${chip(result.decisions[id].status)}`).join('<br>') || '—'}</td>
    <td>${candidates.filter(id => !winners.includes(id)).map(esc).join(', ') || '—'}${overlaps.length ? `<br><span class="muted">⚠ PIN ${overlaps.map(esc).join(', ')} also listed in another territory; counted here</span>` : ''}</td></tr>`).join('');
  $('history').innerHTML = S.history.map(h => `<li>${new Date(h.when).toLocaleTimeString()} · ${esc(h.text)}</li>`).reverse().join('');
  renderSummary();
  renderDetail();
}

function renderSummary() {
  const f = summaryFacts(result, S.history);
  const c = f.counts;
  const filled = f.slots.reduce((s, x) => s + x.filled, 0), total = f.slots.reduce((s, x) => s + x.total, 0);
  $('summary').innerHTML = `
    <p>${f.total} applications: ${['Approved', 'Brand review', 'Conditional', 'Waitlist', 'On hold', 'Not eligible', 'Withdrawn'].filter(s => c[s]).map(s => `${c[s]} ${s.toLowerCase()}`).join(', ')}. ${filled} of ${total} open slots are filled across ${f.slots.length} territories.</p>
    <h3>Needs your attention (${f.attention.length})</h3>
    ${f.attention.length ? `<ul class="attention">${f.attention.map(x => `<li><button class="link" data-open="${esc(x.id)}">${esc(x.id)}</button> ${esc(x.text)}</li>`).join('')}</ul>` : '<p class="muted">Nothing needs a person right now.</p>'}
    <h3>Changes today (${f.changes.length})</h3>
    ${f.changes.length ? `<ul>${f.changes.map(h => `<li>${esc(h.text)}</li>`).join('')}</ul>` : '<p class="muted">No changes since upload.</p>'}
    <p class="muted small">Built from today's decisions by the rules; updated ${new Date().toLocaleTimeString()}.</p>`;
}

$('summary').addEventListener('click', e => { const id = e.target.dataset?.open; if (id) { selected = id; filter = null; render(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
$('counts').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = filter === b.dataset.filter ? null : b.dataset.filter;
  render();
});
$('search').addEventListener('input', e => { query = e.target.value; render(); });
$('sort').addEventListener('change', e => { sortKey = e.target.value; render(); });
$('sort-dir').addEventListener('click', () => { sortAsc = !sortAsc; render(); });
$('apps-head').addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  if (sortKey === th.dataset.sort) sortAsc = !sortAsc; else { sortKey = th.dataset.sort; sortAsc = true; }
  render();
});

const pickRow = e => { const tr = e.target.closest('tr[data-id]'); if (tr) { selected = tr.dataset.id; render(); save(); if (innerWidth < 900) $('detail').scrollIntoView({ behavior: 'smooth' }); } };
$('apps').addEventListener('click', pickRow);
$('apps').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(e); } });

function renderDetail() {
  const d = selected && result.decisions[selected];
  if (!d) { $('detail').innerHTML = '<div class="empty">Select an application to see its decision, evidence and plan.</div>'; return; }
  const a = d.app;
  const facts = [['City · PIN', `${show(a.city || a.cityRaw)} · ${show(a.pin || a.pinRaw)}`], ['Investment', a.investment !== null ? `₹${a.investment} lakh (stated, not verified)` : show(a.investmentRaw)],
    ['Experience', a.experience !== null ? `${a.experience} year${a.experience === 1 ? '' : 's'}` : '—'], ['Business', show(a.business)], ['Space', `${show(a.space ?? a.spaceRaw)}${a.size ? `, ${a.size} sq ft` : ''}${a.floor && a.space !== 'Not yet identified' ? `, ${a.floor}` : ''}`],
    ['Target launch', a.launch !== null ? `${a.launch} month${a.launch === 1 ? '' : 's'}` : '—'], ['Language', show(a.language || a.languageRaw)], ['Notes', show(a.notes)]];
  const p = d.plan;
  const lang = a.language && a.language !== 'English' ? a.language : null;
  const mine = S.history.filter(h => h.kind === 'change' && h.target === d.id);
  $('detail').innerHTML = `
    <div class="row" style="justify-content:space-between"><h2 id="detail-title" style="margin:0" tabindex="-1">${esc(d.id)} · ${esc(a.name) || '(name blank)'}</h2>${chip(d.status)}</div>
    <p style="margin-top:8px">${esc(d.headline)}</p>
    ${isWinner(d) ? '<p class="muted">Passed screening and holds a slot. Final approval is the brand\'s, after identity and funds are verified.</p>' : ''}
    ${d.review.length ? `<h3>Flags for the brand</h3><ul class="flags">${d.review.map(r => `<li>⚑ ${esc(r.text)}</li>`).join('')}</ul>` : ''}
    <h3>Checks, in order</h3>
    <ul class="checks">${d.checks.map(c => `<li><span class="${c.pass ? 'pass' : 'fail'}" aria-label="${c.pass ? 'passed' : 'failed'}">${c.pass ? '✓' : '✗'}</span> <b>${esc(c.name)}</b><br><span class="muted">${esc(c.detail)}</span></li>`).join('')}</ul>
    ${d.score ? `<h3>Score ${d.score.total} / 100${d.rank ? ` · rank ${d.rank} of ${d.rankOf} in ${esc(d.territory)}` : ''}</h3>
      <table><tbody>${d.score.parts.map(s => `<tr><td>${esc(s.factor)}</td><td style="width:30%"><div class="bar" role="img" aria-label="${s.points} of ${s.max}"><i style="width:${100 * s.points / s.max}%"></i></div></td><td>${s.points}/${s.max}</td><td class="muted">${esc(s.why)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${d.info.length ? `<h3>Notes for the brand</h3><ul>${d.info.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    <h3>${p.weeks ? `Onboarding plan · about ${p.weeks} weeks to opening` : 'What happens next'}</h3>
    ${p.steps.length ? `<table><tbody>${p.steps.map(s => `<tr><td>${esc(s.text)}</td><td class="muted">${esc(s.owner)}${s.when ? `<br>${esc(s.when)}` : ''}</td><td><span class="state state-${cls(s.state)}">${esc(s.state)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing further.</p>'}
    ${p.notes?.length ? `<p class="muted" style="margin-top:8px">${p.notes.map(esc).join(' ')}</p>` : ''}
    <h3>Message to the applicant</h3>
    ${lang ? `<p class="muted">English draft. The applicant prefers ${esc(lang)}: translate before sending (no automatic translation yet).</p>` : ''}
    <pre>${esc(p.message)}</pre>
    ${mine.length ? `<h3>Changes to this application</h3><ul>${mine.map(h => `<li>${new Date(h.when).toLocaleTimeString()} · ${esc(h.text)}</li>`).join('')}</ul>` : ''}
    <h3>Applicant's details</h3>
    <table><tbody>${facts.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- follow-ups ----------

function say(who, html) {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.innerHTML = html;
  $('chat').append(el);
  $('chat').scrollTop = $('chat').scrollHeight;
  return el;
}

const fmt = (f, v) => Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : v === null || v === undefined || v === '' ? 'blank' : v === true ? 'yes' : v === false ? 'no' : (f === 'investment' ? `₹${v} lakh` : v);
const changeText = p => `${p.target}: ${p.changes.map(c => `${FIELD_LABEL[c.field] || c.field} ${fmt(c.field, c.from)} → ${fmt(c.field, c.to)}`).join('; ')}`;

$('ask').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q || !result) return;
  $('q').value = '';
  say('you', esc(q));
  const r = interpret(q, S.apps, result, S.territories);

  if (r.type === 'undo') {
    const last = S.undo.pop();
    if (!last) { say('bot', 'There is nothing to undo.'); save(); return; }
    const before = result;
    Object.assign(S, last.state);
    recompute();
    const fx = diff(before, result);
    S.history.push({ when: new Date().toISOString(), kind: 'change', target: last.target, text: `Undid: ${last.text}. ${fx.map(x => `${x.id} ${x.from} → ${x.to}`).join(', ') || 'No status changes.'}` });
    say('bot', esc(`Undone: ${last.text}.${fx.length ? `\n${fx.map(x => `${x.id}: ${x.from} → ${x.to}`).join('\n')}` : ''}`));
    render(); save(); return;
  }
  if (r.type === 'history') {
    const ch = S.history.filter(h => h.kind === 'change');
    say('bot', esc(ch.length ? `Changes since ${S.name} was uploaded:\n${ch.map(h => `• ${new Date(h.when).toLocaleTimeString()}: ${h.text}`).join('\n')}` : `Nothing has changed since ${S.name} was uploaded.`));
    save(); return;
  }
  if (r.type !== 'proposal') {
    let text = r.text;
    if (r.id) {
      const mine = S.history.filter(h => h.kind === 'change' && h.target === r.id);
      if (mine.length) text += `\n\nChange history for ${r.id}:\n${mine.map(h => `• ${h.text}`).join('\n')}`;
      selected = r.id; render();
    }
    say('bot', esc(text)); save();
    return;
  }

  const next = { ...S };
  if (r.kind === 'territory') next.territories = applyTerritoryChange(S.territories, r.target, r.changes);
  else next.apps = applyChanges(S.apps, r.target, r.changes);
  const nextResult = decide(next, { held: S.held });
  const effects = diff(result, nextResult);
  const statusFx = effects.filter(x => x.kind === 'status'), rankFx = effects.filter(x => x.kind === 'rank');
  pending = { ...r, next, nextResult, effects };
  const el = say('bot', `I read this as a change to <b>${esc(r.target)}</b>:<ul>${r.changes.map(c => `<li>${esc(FIELD_LABEL[c.field] || c.field)}: ${esc(fmt(c.field, c.from))} → <b>${esc(fmt(c.field, c.to))}</b></li>`).join('')}</ul>
    ${r.assumptions.length ? `<p class="muted">${r.assumptions.map(esc).join(' ')}</p>` : ''}
    ${r.warnings?.length ? `<p class="warn">⚠ ${r.warnings.map(esc).join(' ')}</p>` : ''}
    ${statusFx.length ? `<p>If applied, status changes:</p><ul>${statusFx.map(x => `<li><b>${esc(x.id)}</b>${x.id !== r.target ? ' (knock-on)' : ''}: ${chip(x.from)} → ${chip(x.to)}<br><span class="muted">${esc(x.why)}</span></li>`).join('')}</ul>` : '<p>No status would change.</p>'}
    ${rankFx.length ? `<p class="muted">Rank changes: ${rankFx.map(x => `${esc(x.id)} ${esc(x.from)} → ${esc(x.to)}`).join(', ')}</p>` : ''}
    <div class="row"><button class="primary" data-act="apply">Apply change</button><button data-act="cancel">Cancel</button></div>`);
  pending.el = el;
  save();
  el.addEventListener('click', ev => {
    const act = ev.target.dataset?.act;
    if (!act) return;
    el.querySelectorAll('button').forEach(b => b.disabled = true);
    // Only the latest proposal can be applied; an older one was computed against a different state.
    if (!pending || pending.el !== el) { say('bot', 'That proposal is out of date. Please send the change again.'); return; }
    if (act === 'cancel') { pending = null; say('bot', 'Cancelled; nothing changed.'); save(); return; }
    const p = pending; pending = null;
    const before = result.decisions[p.target];
    const text = changeText(p);
    S.undo.push({ state: { apps: S.apps, territories: S.territories, held: S.held }, target: p.target, text });
    Object.assign(S, { apps: p.next.apps, territories: p.next.territories });
    result = p.nextResult; S.held = nextHolds(result, S.held);
    S.history.push({ when: new Date().toISOString(), kind: 'change', target: p.target, text: `${text}. ${p.effects.filter(x => x.kind === 'status').map(x => `${x.id} ${x.from} → ${x.to}`).join(', ') || 'No status changes.'}` });
    if (p.kind === 'territory') say('bot', esc(`Applied. ${p.target} now has ${p.changes[0].to} open slot${p.changes[0].to === 1 ? '' : 's'}.`));
    else {
      const after = result.decisions[p.target];
      say('bot', esc(`Applied. ${before.status === after.status ? `${p.target} stays ${after.status}.` : `${p.target} moved from ${before.status} to ${after.status}.`}\n\n${why(after)}`));
      selected = p.target;
    }
    render(); save();
  });
});

for (const ex of ['Why is APP-007 on hold?', 'What would APP-007 need to change to move forward?', 'APP-012 has now found a ground-floor space', 'Who got TER-01?', 'Undo the last change'])
  $('examples').insertAdjacentHTML('beforeend', `<button type="button" data-ex="${esc(ex)}">${esc(ex)}</button>`);
$('examples').addEventListener('click', e => { if (e.target.dataset.ex) { $('q').value = e.target.dataset.ex; $('q').focus(); } });

const [lo, hi] = CONFIG.idealSqft;
$('rules').innerHTML = `<h2>How decisions are made</h2>
<p>Checks run in order, and the first one that fails is the reason:</p>
<ol>
  <li><b>Data complete and consistent.</b> Required fields are present; values are in plausible ranges (investment ₹${CONFIG.plausible.investment.join('–')} lakh, space ${CONFIG.plausible.size.join('–')} sq ft, experience ${CONFIG.plausible.experience.join('–')} years), otherwise "please confirm"; city and PIN agree; the notes don't contradict the form (for example "still searching" with an owned space, or a different PIN); not a likely duplicate (same name, PIN, investment, business and space as an earlier application). Failing this means <b>On hold</b> with the exact questions.</li>
  <li><b>Investment meets the city-tier minimum</b> (inclusive): Tier 1 ₹${CONFIG.tierMinLakh[1]} lakh, Tier 2 ₹${CONFIG.tierMinLakh[2]} lakh, Tier 3 ₹${CONFIG.tierMinLakh[3]} lakh. Otherwise <b>Not eligible</b>, with the gap.</li>
  <li><b>PIN is inside a territory.</b> A PIN listed in two territories counts for the higher-priority one (then the lower ID).</li>
  <li><b>PIN has no existing store.</b></li>
  <li><b>Launch within ${CONFIG.launchMaxMonths} months.</b> 0 months is read as "as soon as possible".</li>
</ol>
<p>Applicants who pass are scored out of 100 (investment 25, space 15 with owned and rented equal, floor 10, size 5, experience 15, relevant business 5, launch realism 10, territory priority 10, completeness 5). Slots are filled in score order, with ties broken by application ID and one store per PIN. A Conditional applicant keeps their slot for ${CONFIG.holdDays} days even if someone overtakes them later.</p>
<p>Winners are <b>Approved</b> with a ground-floor or mall site of at least ${CONFIG.siteMinSqft} sq ft (ideal ${lo}–${hi}); otherwise <b>Conditional</b>. Winners go to <b>Brand review</b> instead if they are in a PIN next to an existing store or another winner, mention money already paid, may have a conflict of interest, or someone else will run the store.</p>
<p>Notes are read by rules that look for meaning, not exact phrases. Text that tries to instruct the system is ignored. Name, gender, age, religion, caste and language never affect a decision. Investment is as stated by the applicant until it is verified. All thresholds are proposed defaults for the brand to confirm.</p>`;

// Restore a session after a refresh.
try {
  const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  if (saved?.S) {
    S = saved.S; selected = saved.selected;
    recompute();
    $('chat').innerHTML = saved.chat || '';
    $('chat').querySelectorAll('button').forEach(b => b.disabled = true); // proposals from before the refresh can't be applied
    showProblems(S.problems || []);
    render();
  }
} catch { /* unreadable saved session: start fresh */ }
