import { readWorkbook, decide, interpret, applyChanges, diff, why, CONFIG, FIELD_LABEL, STATUS_RANK, idNum } from './engine.js';
import { SAMPLE_SHEETS } from './sample.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chip = s => `<span class="chip s-${s.replace(/ /g, '-')}">${esc(s)}</span>`;
const show = v => (v === null || v === undefined || v === '' ? '—' : v);

// All state lives in this tab only.
let wb = null, result = null, selected = null, filter = null, pending = null;
const history = [];

function load(sheets, name) {
  const r = readWorkbook(sheets);
  const fatal = r.problems.filter(p => p.fatal);
  $('problems').classList.toggle('hidden', !r.problems.length);
  $('problems').innerHTML = r.problems.map(p => `<li class="${p.fatal ? 'fatal' : 'muted'}">${esc(p.text)}</li>`).join('');
  if (fatal.length) { $('results').classList.add('hidden'); $('filename').textContent = `${name}: not processed`; return; }
  wb = r; result = decide(wb); selected = null; filter = null; pending = null; history.length = 0;
  $('filename').textContent = `${name}: ${wb.apps.length} applications, ${wb.territories.length} territories, ${wb.stores.length} existing stores`;
  $('chat').innerHTML = '';
  history.push({ when: new Date(), text: `Processed ${name}.` });
  $('results').classList.remove('hidden');
  render();
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

function render() {
  const ds = Object.values(result.decisions).sort((a, b) => idNum(a.id) - idNum(b.id) || a.id.localeCompare(b.id));
  const counts = {};
  for (const d of ds) counts[d.status] = (counts[d.status] || 0) + 1;
  $('counts').innerHTML = Object.keys(STATUS_RANK).reverse().map(s =>
    `<button data-filter="${esc(s)}" aria-pressed="${filter === s}"><b>${counts[s] || 0}</b>${chip(s)}</button>`).join('');
  $('apps').innerHTML = ds.filter(d => !filter || d.status === filter).map(d => `
    <tr tabindex="0" data-id="${esc(d.id)}" class="${d.id === selected ? 'sel' : ''}">
      <td><b>${esc(d.id)}</b></td><td>${esc(d.app.name)}</td>
      <td>${esc(d.app.city || d.app.cityRaw)} · ${esc(d.app.pin || d.app.pinRaw)}</td>
      <td>${chip(d.status)}</td><td>${d.score ? d.score.total : '—'}</td><td>${esc(d.headline)}</td></tr>`).join('');
  $('terr').innerHTML = Object.values(result.territories).map(({ territory: t, winners, candidates }) => `
    <tr data-terr="${esc(t.id)}"><td><b>${esc(t.id)}</b></td><td>${esc(t.city)}</td><td>${esc(t.priority)}</td><td>${winners.length} / ${t.slots}</td>
    <td>${winners.map(id => `${esc(id)} ${chip(result.decisions[id].status)}`).join('<br>') || '—'}</td>
    <td>${candidates.filter(id => !winners.includes(id)).map(esc).join(', ') || '—'}</td></tr>`).join('');
  $('history').innerHTML = history.map(h => `<li>${h.when.toLocaleTimeString()} · ${esc(h.text)}</li>`).reverse().join('');
  renderDetail();
}

$('counts').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = filter === b.dataset.filter ? null : b.dataset.filter;
  render();
});
const pickRow = e => { const tr = e.target.closest('tr[data-id]'); if (tr) { selected = tr.dataset.id; render(); if (innerWidth < 900) $('detail').scrollIntoView({ behavior: 'smooth' }); } };
$('apps').addEventListener('click', pickRow);
$('apps').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(e); } });

function renderDetail() {
  const d = selected && result.decisions[selected];
  if (!d) { $('detail').innerHTML = '<div class="empty">Select an application to see its decision, evidence and plan.</div>'; return; }
  const a = d.app;
  const facts = [['City · PIN', `${show(a.city || a.cityRaw)} · ${show(a.pin || a.pinRaw)}`], ['Investment', a.investment !== null ? `₹${a.investment} lakh (stated, not verified)` : show(a.investmentRaw)],
    ['Experience', a.experience !== null ? `${a.experience} years` : '—'], ['Business', show(a.business)], ['Space', `${show(a.space ?? a.spaceRaw)}${a.size ? `, ${a.size} sq ft` : ''}${a.floor && a.space !== 'Not yet identified' ? `, ${a.floor}` : ''}`],
    ['Target launch', a.launch !== null ? `${a.launch} months` : '—'], ['Language', show(a.language || a.languageRaw)], ['Notes', show(a.notes)]];
  const p = d.plan;
  $('detail').innerHTML = `
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(d.id)} · ${esc(a.name)}</h2>${chip(d.status)}</div>
    <p style="margin-top:8px">${esc(d.headline)}</p>
    ${d.status === 'Approved' ? '<p class="muted">Passed screening and holds a slot. Final approval is the brand\'s, after identity and funds are verified.</p>' : ''}
    <h3>Checks, in order</h3>
    <ul class="checks">${d.checks.map(c => `<li><span class="${c.pass ? 'pass' : 'fail'}">${c.pass ? '✓' : '✗'}</span> <b>${esc(c.name)}</b><br><span class="muted">${esc(c.detail)}</span></li>`).join('')}</ul>
    ${d.score ? `<h3>Score ${d.score.total} / 100${d.rank ? ` · rank ${d.rank} of ${d.rankOf} in ${esc(d.territory)}` : ''}</h3>
      <table><tbody>${d.score.parts.map(s => `<tr><td>${esc(s.factor)}</td><td style="width:30%"><div class="bar"><i style="width:${100 * s.points / s.max}%"></i></div></td><td>${s.points}/${s.max}</td><td class="muted">${esc(s.why)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${d.info.length ? `<h3>Notes for the brand</h3><ul>${d.info.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    <h3>${p.weeks ? `Onboarding plan · about ${p.weeks} weeks to opening` : 'What happens next'}</h3>
    <table><tbody>${p.steps.map(s => `<tr><td>${esc(s.text)}</td><td class="muted">${esc(s.owner)}${s.when ? `<br>${esc(s.when)}` : ''}</td><td><span class="state state-${s.state.replace(/ /g, '-')}">${esc(s.state)}</span></td></tr>`).join('')}</tbody></table>
    ${p.notes?.length ? `<p class="muted" style="margin-top:8px">${p.notes.map(esc).join(' ')}</p>` : ''}
    <h3>Message to the applicant (draft${a.language && a.language !== 'English' ? `; send in ${esc(a.language)}` : ''})</h3>
    <pre>${esc(p.message)}</pre>
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

const fmt = (f, v) => v === null || v === undefined || v === '' ? 'blank' : (f === 'investment' ? `₹${v} lakh` : v);

$('ask').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q || !result) return;
  $('q').value = '';
  say('you', esc(q));
  const r = interpret(q, wb.apps, result);
  if (r.type !== 'proposal') {
    say('bot', esc(r.text));
    const m = q.match(/app[\s#-]*0*(\d+)/i);
    const hit = m && Object.keys(result.decisions).find(id => idNum(id) === Number(m[1]));
    if (hit) { selected = hit; render(); }
    return;
  }
  const nextApps = applyChanges(wb.apps, r.app, r.changes);
  const next = decide({ ...wb, apps: nextApps });
  const effects = diff(result, next);
  pending = { ...r, nextApps, next, effects };
  const el = say('bot', `I read this as a change to <b>${esc(r.app)}</b>:<ul>${r.changes.map(c => `<li>${esc(FIELD_LABEL[c.field])}: ${esc(fmt(c.field, c.from))} → <b>${esc(fmt(c.field, c.to))}</b></li>`).join('')}</ul>
    ${r.assumptions.length ? `<p class="muted">${r.assumptions.map(esc).join(' ')}</p>` : ''}
    ${effects.length ? `<p>If applied:</p><ul>${effects.map(x => `<li><b>${esc(x.id)}</b>${x.id !== r.app ? ' (knock-on)' : ''}: ${chip(x.from)} → ${chip(x.to)}<br><span class="muted">${esc(x.why)}</span></li>`).join('')}</ul>` : '<p>No decision would change.</p>'}
    <div class="row"><button class="primary" data-act="apply">Apply change</button><button data-act="cancel">Cancel</button></div>`);
  el.addEventListener('click', ev => {
    const act = ev.target.dataset?.act;
    if (!act || !pending) return;
    el.querySelectorAll('button').forEach(b => b.disabled = true);
    if (act === 'cancel') { pending = null; say('bot', 'Cancelled; nothing changed.'); return; }
    const before = result.decisions[pending.app];
    wb = { ...wb, apps: pending.nextApps };
    result = pending.next;
    const after = result.decisions[pending.app];
    history.push({ when: new Date(), text: `${pending.app}: ${pending.changes.map(c => `${FIELD_LABEL[c.field]} ${fmt(c.field, c.from)} → ${fmt(c.field, c.to)}`).join('; ')}. ${pending.effects.map(x => `${x.id} ${x.from} → ${x.to}`).join(', ') || 'No status changes.'}` });
    say('bot', esc(`Applied. ${before.status === after.status ? `${pending.app} stays ${after.status}.` : `${pending.app} moved from ${before.status} to ${after.status}.`}\n\n${why(after)}`));
    selected = pending.app; pending = null;
    render();
  });
});

for (const ex of ['Why is APP-007 on hold?', 'What would APP-007 need to change to move forward?', 'APP-012 has now found a ground-floor space', 'Who got TER-01?'])
  $('examples').insertAdjacentHTML('beforeend', `<button type="button" data-ex="${esc(ex)}">${esc(ex)}</button>`);
$('examples').addEventListener('click', e => { if (e.target.dataset.ex) { $('q').value = e.target.dataset.ex; $('q').focus(); } });

$('rules').innerHTML = `<b>How decisions are made.</b> Checks run in order and the first failure is the reason: data complete and consistent → investment meets the city-tier minimum
(Tier 1 ₹${CONFIG.tierMinLakh[1]} lakh, Tier 2 ₹${CONFIG.tierMinLakh[2]} lakh, Tier 3 ₹${CONFIG.tierMinLakh[3]} lakh) → PIN inside a territory → PIN has no existing store.
Applicants who pass are scored out of 100 (investment 25, space 15, floor 10, size 5, experience 15, relevant business 5, launch realism 10, territory priority 10, completeness 5)
and slots are filled in score order (ties by application ID), one store per PIN. Winners with a ground-floor or mall site of at least ${CONFIG.siteMinSqft} sq ft are Approved; others are Conditional with the slot held ${CONFIG.holdDays} days.
Name, gender, age and language never affect a decision. Thresholds are proposed defaults for the brand to confirm. Investment is as stated by the applicant until verified.`;
