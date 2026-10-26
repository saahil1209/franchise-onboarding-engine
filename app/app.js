import { readWorkbook, decide, interpret, applyChanges, applyTerritoryChange, diff, why, nextHolds, summaryFacts, isWinner, CONFIG, FIELD_LABEL, STATUS_RANK, idNum } from './engine.js';
import { overview, finding } from './dashboard.js';
import { mountMap } from './map.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cls = s => s.replace(/ /g, '-');
const chip = s => `<span class="tag s-${cls(s)}">${esc(s)}</span>`;
const show = v => (v === null || v === undefined || v === '' ? '—' : v);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STORE_KEY = 'franchise-session-v2';
const VIEWS = ['home', 'applications', 'territories', 'history'];

// All state lives in this tab (and its sessionStorage, so a refresh keeps it).
let S = null; // { name, apps, territories, stores, problems, held, history: [], undo: [] }
let result = null, O = null, selected = null, filter = null, pending = null, city = 'Bengaluru';
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

// ---------- views ----------
function route() {
  const [v, arg] = decodeURIComponent(location.hash.slice(1)).split('/');
  const view = VIEWS.includes(v) ? v : 'home';
  if (view === 'territories' && arg && O?.cities.some(c => c.name === arg)) city = arg;
  if (view === 'applications' && arg && result?.decisions[arg]) selected = arg;
  return view;
}
function showView() {
  const view = route();
  const loaded = !!S;
  $('welcome').classList.toggle('hidden', loaded);
  for (const el of document.querySelectorAll('.view')) {
    // Before a workbook is loaded only the rules show, under the welcome card.
    const on = loaded ? el.dataset.view === view : el.dataset.view === 'history';
    el.classList.toggle('hidden', !on);
  }
  $('history').closest('section').classList.toggle('hidden', !loaded);
  for (const a of $('nav').querySelectorAll('a')) {
    if (loaded && a.dataset.view === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  $('nav').classList.toggle('hidden', !loaded); $('topsearch').classList.toggle('hidden', !loaded);
  if (loaded) render();
  maps.home.relayout(); maps.full.relayout();
  light();
}
const go = hash => { if (location.hash === hash) showView(); else location.hash = hash; };
addEventListener('hashchange', () => { showView(); scrollTo({ top: 0, behavior: 'instant' }); });

// ---------- loading ----------
function load(sheets, name) {
  const r = readWorkbook(sheets);
  const fatal = r.problems.filter(p => p.fatal);
  if (fatal.length) {
    // A bad file never replaces a session that is already loaded.
    showProblems([{ fatal: true, text: `${name} was not processed.` }, ...r.problems]);
    showView(); return;
  }
  showProblems(r.problems);
  S = { name, apps: r.apps, territories: r.territories, stores: r.stores, problems: r.problems, held: {}, history: [{ when: new Date().toISOString(), kind: 'upload', text: `Processed ${name}.` }], undo: [] };
  selected = null; filter = null; pending = null; query = ''; $('search').value = ''; $('topsearch').value = '';
  $('chat').innerHTML = '';
  recompute();
  go('#home'); save();
}

function showProblems(problems) {
  for (const id of ['problems', 'problems-loaded']) {
    $(id).classList.toggle('hidden', !problems.length);
    $(id).innerHTML = problems.map(p => `<li class="${p.fatal ? 'fatal' : ''}">${esc(p.text)}</li>`).join('');
  }
}

for (const input of document.querySelectorAll('input.file')) input.addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 5e6) { showProblems([{ fatal: true, text: `${f.name} is over 5 MB; please upload the case workbook.` }]); return; }
  try {
    const book = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const sheets = Object.fromEntries(book.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1, defval: '', raw: true })]));
    load(sheets, f.name);
  } catch (err) {
    showProblems([{ fatal: true, text: `Couldn't read ${f.name}: ${err.message}` }]);
  }
  e.target.value = '';
});
$('reset').addEventListener('click', () => {
  if (!confirm('Clear this session? The uploaded data, decisions, changes and chat will be removed from this tab.')) return;
  try { sessionStorage.removeItem(STORE_KEY); } catch { /* nothing stored */ }
  S = result = O = selected = filter = pending = null;
  $('chat').innerHTML = ''; showProblems([]);
  go('#home');
});
$('export').addEventListener('click', () => {
  const ds = Object.values(result.decisions).sort((a, b) => idNum(a.id) - idNum(b.id));
  const rows = [['Application ID', 'Applicant', 'City', 'PIN', 'Status', 'Score', 'Territory', 'Rank', 'Reason', 'Flags for the brand', 'Questions for the applicant']]
    .concat(ds.map(d => [d.id, d.app.name, d.app.city || d.app.cityRaw, d.app.pin || d.app.pinRaw, d.status, d.score ? d.score.total : '', d.territory || '', d.rank ? `${d.rank} of ${d.rankOf}` : '', d.headline, d.review.map(r => r.text).join(' | '), d.questions.join(' | ')]));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Decisions');
  XLSX.writeFile(book, `decisions-${S.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-')}.xlsx`);
});

// ---------- render ----------
function render() {
  O = overview(result);
  $('src').textContent = `${S.name} · ${S.apps.length} applications · ${S.territories.length} territories · ${S.stores.length} existing stores`;
  renderHome();
  renderApplications();
  renderTerritories();
  renderHistory();
}

const tagOf = q => q.fraud ? ['Possible fraud', 'fraud'] : q.status === 'Brand review' ? ['Brand review', 'review'] : q.status === 'On hold' ? ['On hold', 'hold'] : q.status === 'Conditional' ? ['Conditional', 'review'] : ['Flagged', 'review'];

function renderHome() {
  const c = O.counts, held = O.filled - c['Approved'];
  $('file-meta').textContent = `${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${S.name}`;
  $('finding').textContent = finding(O).join(' ');
  $('work').textContent = O.queue.length ? `Work through ${O.queue.length}` : 'Open applications';
  const kpi = (l, v, n) => `<div class="kpi"><span>${l}</span><b>${v}</b><em>${n}</em></div>`;
  $('kpis').innerHTML = kpi('Slots with a partner', `${O.filled}<small> / ${O.slots}</small>`, `${held} held, not final`)
    + kpi('Applications', O.total, `${O.stores} existing stores`)
    + kpi('Needs a person', O.queue.length, `${c['On hold']} on hold, ${O.queue.length - c['On hold']} flagged or held`)
    + kpi('Approved', c['Approved'], 'pending verification')
    + kpi('Waitlist', c['Waitlist'], `${c['Not eligible']} not eligible`);

  $('q-n').textContent = `${O.queue.length} total`;
  $('queue').innerHTML = O.queue.length ? O.queue.slice(0, 5).map(q => { const [t, k] = tagOf(q); return `<li data-city="${esc(q.city)}"><span class="who">${esc(q.name)}</span><span class="tag ${k}">${t}</span><span class="why">${esc(q.id)} · ${esc(q.why)}</span><span class="act"><button data-explain="${esc(q.id)}">Explain</button><button data-open="${esc(q.id)}">Open</button></span></li>`; }).join('') : '<li class="empty" style="display:block">Nothing needs a person right now.</li>';
  $('q-all').textContent = O.queue.length > 5 ? `View all ${O.queue.length}` : 'Open applications';

  $('p-n').textContent = `${O.total} applications`;
  $('stack').innerHTML = O.parts.filter(p => p.n).map(p => `<i style="flex:${p.n};background:${p.color}" title="${p.label} ${p.n}"></i>`).join('');
  $('parts').innerHTML = O.parts.map(p => `<tr><td><span class="dot" style="background:${p.color}"></span>${p.label}</td><td class="n">${p.n}</td><td class="s">${O.total ? Math.round((100 * p.n) / O.total) : 0}%</td></tr>`).join('');
  $('holds-wrap').classList.toggle('hidden', !O.holdReasons.length);
  $('holds').innerHTML = O.holdReasons.map(h => `<tr><td>${h.label}</td><td class="n">${h.n}</td><td class="s"></td></tr>`).join('');

  renderScores();

  $('onb').innerHTML = O.onboarding.length ? O.onboarding.slice(0, 5).map(w => `<li><span><b>${esc(w.name)}</b> · ${esc(w.city)}</span><span class="wk">${w.weeks} wk</span><span class="m">${esc(w.id)} · ${esc(w.track)} in ${esc(w.language)}${w.buddy ? ` · buddy ${esc(w.buddy)}` : ''}</span></li>`).join('') + (O.onboarding.length > 5 ? `<li><span class="m">and ${O.onboarding.length - 5} more approved</span></li>` : '') : '<li class="m">No approved partners yet.</li>';

  // Today: events derived from the decisions and the change history.
  const f = summaryFacts(result, S.history);
  const events = [['var(--blue)', `<b>${esc(S.name)}</b> processed: ${O.total} applications, ${S.territories.length} territories, ${O.stores} existing stores.`]];
  if (O.fraud.length) events.push(['var(--red)', `<b>${O.fraud.map(esc).join(', ')}</b> mention${O.fraud.length === 1 ? 's' : ''} money already paid; flagged for the brand and the applicant warned.`]);
  if (O.empty.length) events.push(['var(--red)', `<b>${O.empty.map(t => esc(t.id)).join(', ')}</b> ${O.empty.length === 1 ? 'has' : 'have'} an open slot.`]);
  if (O.review.length) events.push(['var(--amber)', `<b>${O.review.map(esc).join(', ')}</b> hold${O.review.length === 1 ? 's' : ''} a slot pending brand review.`]);
  if (O.duplicates.length) events.push(['var(--amber)', `<b>${O.duplicates.map(d => esc(d.id)).join(', ')}</b> look${O.duplicates.length === 1 ? 's' : ''} like a duplicate of ${O.duplicates.map(d => esc(d.of)).join(', ')}.`]);
  if (c['Approved']) events.push(['var(--blue)', `<b>${c['Approved']} partner${c['Approved'] === 1 ? '' : 's'}</b> approved and given onboarding plans.`]);
  for (const h of f.changes) events.push(['var(--ink)', `${new Date(h.when).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · ${esc(h.text)}`]);
  $('activity').innerHTML = events.map(([col, t]) => `<li><i style="background:${col}"></i><span>${t}</span></li>`).join('');

  maps.home.set(O.cities, null);
}

function renderScores() {
  if (!O.bins.length || !O.scored) { $('scores').innerHTML = '<p class="empty">Nobody has passed screening yet.</p>'; $('s-note').textContent = ''; return; }
  const W = 360, H = 230, pl = 24, pb = 22, top = 6, max = Math.max(...O.bins.map(b => b.n)), yMax = Math.max(2, Math.ceil((max + 1) / 2) * 2);
  const step = yMax > 12 ? Math.ceil(yMax / 6 / 2) * 2 : 2;
  const y = v => top + (H - pb - top) * (1 - v / yMax), band = (W - pl) / O.bins.length, bw = band * 0.58;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Eligible applicants by score band; slot winners at the base">`;
  for (let v = 0; v <= yMax; v += step) s += `<line x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${v ? 'rgba(19,33,58,.08)' : 'rgba(19,33,58,.22)'}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#5c687a">${v}</text>`;
  O.bins.forEach((b, i) => {
    const cx = pl + band * i + band / 2, x = cx - bw / 2;
    if (b.won) s += `<rect x="${x}" y="${y(b.won)}" width="${bw}" height="${y(0) - y(b.won)}" rx="3" fill="#1f5fbf"><title>${b.label}: ${b.won} hold a slot</title></rect>`;
    if (b.n - b.won) s += `<rect x="${x}" y="${y(b.n)}" width="${bw}" height="${y(b.won) - y(b.n) - (b.won ? 2 : 0)}" rx="3" fill="#b8c1cd"><title>${b.label}: ${b.n - b.won} waiting</title></rect>`;
    s += `<text x="${cx}" y="${H - 5}" text-anchor="middle" font-size="11" fill="#5c687a">${b.label}</text>`;
  });
  $('scores').innerHTML = s + '</svg>';
  const ws = O.winners.map(w => w.score);
  $('s-note').textContent = `${O.scored} eligible applicant${O.scored === 1 ? '' : 's'}.${ws.length ? ` Slot winners scored ${Math.min(...ws)}–${Math.max(...ws)}.` : ''}`;
}

$('work').addEventListener('click', () => { const first = O.queue[0]; go(first ? `#applications/${first.id}` : '#applications'); });
$('q-all').addEventListener('click', () => go('#applications'));
$('queue').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.open) return go(`#applications/${b.dataset.open}`);
  const d = result.decisions[b.dataset.explain];
  ask(`Why is ${d.id} ${d.status === 'On hold' ? 'on hold' : d.status === 'Brand review' ? 'in brand review' : d.status.toLowerCase()}?`);
  $('askcard').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
});

// ---------- applications ----------
function renderApplications() {
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
      <td>${chip(d.status)}${d.review.length && d.status !== 'Brand review' ? ' <span title="Has a flag for the brand" aria-label="flagged">⚑</span>' : ''}</td><td class="n">${d.score ? d.score.total : '—'}</td><td>${esc(d.headline)}</td></tr>`).join('');
  renderDetail();
}

$('counts').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = filter === b.dataset.filter ? null : b.dataset.filter;
  renderApplications();
});
$('search').addEventListener('input', e => { query = e.target.value; $('topsearch').value = query; renderApplications(); });
$('topsearch').addEventListener('input', e => {
  query = e.target.value; $('search').value = query; filter = null;
  if (route() !== 'applications') go('#applications'); else renderApplications();
});
$('sort').addEventListener('change', e => { sortKey = e.target.value; renderApplications(); });
$('sort-dir').addEventListener('click', () => { sortAsc = !sortAsc; renderApplications(); });
$('apps-head').addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  if (sortKey === th.dataset.sort) sortAsc = !sortAsc; else { sortKey = th.dataset.sort; sortAsc = true; }
  renderApplications();
});
const pickRow = e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  selected = tr.dataset.id; history.replaceState(null, '', `#applications/${selected}`);
  renderApplications(); save();
  if (innerWidth < 1180) $('detail').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
};
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
    <div class="head"><h2 id="detail-title" tabindex="-1">${esc(d.id)} · ${esc(a.name) || '(name blank)'}</h2>${chip(d.status)}</div>
    <p style="margin-top:8px">${esc(d.headline)}</p>
    ${isWinner(d) ? '<p class="muted">Passed screening and holds a slot. Final approval is the brand\'s, after identity and funds are verified.</p>' : ''}
    ${d.review.length ? `<h3>Flags for the brand</h3><ul class="flags">${d.review.map(r => `<li>⚑ ${esc(r.text)}</li>`).join('')}</ul>` : ''}
    <h3>Checks, in order</h3>
    <ul class="checks">${d.checks.map(c => `<li><span class="${c.pass ? 'pass' : 'fail'}" aria-label="${c.pass ? 'passed' : 'failed'}">${c.pass ? '✓' : '✗'}</span> <b>${esc(c.name)}</b><br><span class="muted">${esc(c.detail)}</span></li>`).join('')}</ul>
    ${d.score ? `<h3>Score ${d.score.total} / 100${d.rank ? ` · rank ${d.rank} of ${d.rankOf} in ${esc(d.territory)}` : ''}</h3>
      <table class="data"><tbody>${d.score.parts.map(s => `<tr><td>${esc(s.factor)}</td><td style="width:25%"><div class="bar" role="img" aria-label="${s.points} of ${s.max}"><i style="width:${100 * s.points / s.max}%"></i></div></td><td class="n">${s.points}/${s.max}</td><td class="muted">${esc(s.why)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${d.info.length ? `<h3>Notes for the brand</h3><ul>${d.info.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    <h3>${p.weeks ? `Onboarding plan · about ${p.weeks} weeks to opening` : 'What happens next'}</h3>
    ${p.steps.length ? `<table class="data"><tbody>${p.steps.map(s => `<tr><td>${esc(s.text)}</td><td class="muted">${esc(s.owner)}${s.when ? `<br>${esc(s.when)}` : ''}</td><td><span class="state state-${cls(s.state)}">${esc(s.state)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing further.</p>'}
    ${p.notes?.length ? `<p class="muted" style="margin-top:8px">${p.notes.map(esc).join(' ')}</p>` : ''}
    <h3>Message to the applicant</h3>
    ${lang ? `<p class="muted">English draft. The applicant prefers ${esc(lang)}: translate before sending (no automatic translation yet).</p>` : ''}
    <pre>${esc(p.message)}</pre>
    ${mine.length ? `<h3>Changes to this application</h3><ul>${mine.map(h => `<li>${new Date(h.when).toLocaleTimeString()} · ${esc(h.text)}</li>`).join('')}</ul>` : ''}
    <h3>Applicant's details</h3>
    <table class="data"><tbody>${facts.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- territories ----------
function renderTerritories() {
  if (!O.cities.some(c => c.name === city)) city = O.cities[0]?.name;
  maps.full.set(O.cities, city);
  const c = O.cities.find(x => x.name === city);
  const terr = O.territories.filter(t => t.city === city);
  $('citypanel').innerHTML = !c ? '' : `
    <header><h2>${esc(c.name)}</h2></header>
    <p class="muted">${c.apps} applications · ${c.stores} existing store${c.stores === 1 ? '' : 's'} · ${terr.length ? `${c.filled} of ${c.slots} slots filled` : 'no territory'}</p>
    ${terr.length ? terr.map(t => {
      const comp = Object.values(result.decisions).filter(d => d.territory === t.id && d.score).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.score.total - a.score.total);
      const won = new Set(t.winners);
      return `<div class="terrcard"><div class="t"><h3>${esc(t.id)}</h3><span class="meta">${esc(t.priority)} priority · ${t.applicants} applied</span></div>
        <div class="slots" aria-label="${t.approved} approved, ${t.pending} held, ${t.slots - t.approved - t.pending} open">${[...Array(t.slots)].map((_, k) => `<span class="slot ${k < t.approved ? 'won' : k < t.approved + t.pending ? 'held' : ''}"></span>`).join('') || '<span class="meta">No open slots here now</span>'}</div>
        ${comp.length ? `<div class="bars">${comp.map(d => `<div class="b ${won.has(d.id) ? 'won' : ''}"><button data-open="${esc(d.id)}" title="${esc(d.status)}">${esc(d.id)}</button><span class="bt"><i style="width:${d.score.total}%"></i></span><span>${d.score.total}</span></div>`).join('')}</div>` : (t.slots ? '<p class="empty-note">Open slot, nobody eligible yet</p>' : '')}
      </div>`;
    }).join('') : '<p class="empty-note">No territory covers this city yet; applicants here are waitlisted.</p>'}
    <p class="meta">Blue holds a slot; bars are scores out of 100. Click an ID to open it.</p>`;
  $('terr').innerHTML = Object.values(result.territories).map(({ territory: t, winners, candidates, overlaps }) => `
    <tr><td><b>${esc(t.id)}</b></td><td>${esc(t.city)}</td><td>${esc(t.priority)}</td><td class="n">${winners.length} / ${t.slots}</td>
    <td>${winners.map(id => `${esc(id)} ${chip(result.decisions[id].status)}`).join('<br>') || '—'}</td>
    <td>${candidates.filter(id => !winners.includes(id)).map(esc).join(', ') || '—'}${overlaps.length ? `<br><span class="muted">⚠ PIN ${overlaps.map(esc).join(', ')} also listed in another territory; counted here</span>` : ''}</td></tr>`).join('');
}
$('citypanel').addEventListener('click', e => { const id = e.target.closest('button[data-open]')?.dataset.open; if (id) go(`#applications/${id}`); });

const maps = {
  home: mountMap($('map-home'), { onPick: name => go(`#territories/${name}`) }),
  full: mountMap($('map-full'), { onPick: name => { city = name; history.replaceState(null, '', `#territories/${name}`); renderTerritories(); } }),
};

// ---------- history and rules ----------
function renderHistory() {
  $('history').innerHTML = S.history.map(h => `<li>${new Date(h.when).toLocaleTimeString()} · ${esc(h.text)}</li>`).reverse().join('');
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

$('ask').addEventListener('submit', e => { e.preventDefault(); ask($('q').value.trim()); });

function ask(q) {
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
      selected = r.id;
    }
    const el = say('bot', esc(text) + (r.id && result.decisions[r.id] ? `<div class="row"><button class="btn small" data-act="open" data-id="${esc(r.id)}">Open ${esc(r.id)}</button></div>` : ''));
    el.addEventListener('click', ev => { const id = ev.target.dataset?.id; if (ev.target.dataset?.act === 'open' && id) go(`#applications/${id}`); });
    save();
    return;
  }

  const next = { ...S };
  if (r.kind === 'territory') next.territories = applyTerritoryChange(S.territories, r.target, r.changes);
  else next.apps = applyChanges(S.apps, r.target, r.changes);
  const nextResult = decide(next, { held: S.held });
  const effects = diff(result, nextResult);
  const statusFx = effects.filter(x => x.kind === 'status'), rankFx = effects.filter(x => x.kind === 'rank');
  pending = { ...r, next, nextResult, effects };
  const el = say('bot', `I read this as a change to <b>${esc(r.target)}</b>:<ul>${r.changes.map(c => `<li>${esc(FIELD_LABEL[c.field] || c.field)}: ${esc(fmt(c.field, c.from))} → <b>${esc(fmt(c.field, c.to))}</b></li>`).join('')}</ul>${r.assumptions.length ? `<p class="muted">${r.assumptions.map(esc).join(' ')}</p>` : ''}${r.warnings?.length ? `<p class="warn">⚠ ${r.warnings.map(esc).join(' ')}</p>` : ''}${statusFx.length ? `<p>If applied, status changes:</p><ul>${statusFx.map(x => `<li><b>${esc(x.id)}</b>${x.id !== r.target ? ' (knock-on)' : ''}: ${chip(x.from)} → ${chip(x.to)}<br><span class="muted">${esc(x.why)}</span></li>`).join('')}</ul>` : '<p>No status would change.</p>'}${rankFx.length ? `<p class="muted">Rank changes: ${rankFx.map(x => `${esc(x.id)} ${esc(x.from)} → ${esc(x.to)}`).join(', ')}</p>` : ''}<div class="row"><button class="btn primary small" data-act="apply">Apply change</button><button class="btn small" data-act="cancel">Cancel</button></div>`);
  pending.el = el;
  save();
  el.addEventListener('click', ev => {
    const act = ev.target.dataset?.act;
    if (act !== 'apply' && act !== 'cancel') return;
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
}

for (const ex of ['Why is APP-007 on hold?', 'What would APP-007 need to change to move forward?', 'APP-012 has now found a ground-floor space', 'Who got TER-01?', 'Undo the last change'])
  $('examples').insertAdjacentHTML('beforeend', `<button type="button" data-ex="${esc(ex)}">${esc(ex)}</button>`);
$('examples').addEventListener('click', e => { if (e.target.dataset.ex) { $('q').value = e.target.dataset.ex; $('q').focus(); } });

const [lo, hi] = CONFIG.idealSqft;
$('rules').innerHTML = `<header><h2>How decisions are made</h2></header>
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
<p class="muted">Notes are read by rules that look for meaning, not exact phrases. Text that tries to instruct the system is ignored. Name, gender, age, religion, caste and language never affect a decision. Investment is as stated by the applicant until it is verified. All thresholds are proposed defaults for the brand to confirm.</p>`;

// ---------- glass lighting: each card's shadow falls away from the cursor ----------
const pointer = { x: -9999, y: -9999 };
let lightQueued = false;
function light() {
  lightQueued = false;
  const has = pointer.x > -999;
  for (const el of document.querySelectorAll('.glass')) {
    if (!el.getClientRects().length) continue; // hidden view
    const r = el.getBoundingClientRect(), vx = r.left + r.width / 2 - pointer.x, vy = r.top + r.height / 2 - pointer.y, d = Math.hypot(vx, vy) || 1, k = Math.min(1, 380 / d);
    el.style.setProperty('--sx', `${has ? (vx / d) * 12 * k : 0}px`); el.style.setProperty('--sy', `${has ? (vy / d) * 12 * k + 10 : 14}px`);
    el.style.setProperty('--sb', `${has ? 36 + 24 * k : 40}px`); el.style.setProperty('--sa', `${has ? 0.08 + 0.08 * k : 0.1}`);
  }
}
const queueLight = () => { if (!lightQueued) { lightQueued = true; requestAnimationFrame(light); } };
addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY; queueLight(); });
document.addEventListener('mouseleave', () => { pointer.x = pointer.y = -9999; queueLight(); });
addEventListener('scroll', queueLight, { passive: true });

// ---------- start ----------
$('date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
try {
  const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
  if (saved?.S) {
    S = saved.S; selected = saved.selected;
    recompute();
    $('chat').innerHTML = saved.chat || '';
    $('chat').querySelectorAll('button').forEach(b => b.disabled = true); // proposals from before the refresh can't be applied
    showProblems(S.problems || []);
  }
} catch { /* unreadable saved session: start fresh */ }
showView();
