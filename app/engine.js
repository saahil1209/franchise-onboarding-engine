// Case 1 decision engine. Pure functions, no DOM: rules decide, the score ranks, every reason is recorded.

export const CITIES = {
  'Bengaluru': { prefix: '560', tier: 1 },
  'Mysuru': { prefix: '570', tier: 2 },
  'Mangaluru': { prefix: '575', tier: 2 },
  'Hubballi-Dharwad': { prefix: '580', tier: 2 },
  'Belagavi': { prefix: '590', tier: 2 },
  'Tumakuru': { prefix: '572', tier: 3 },
  'Davanagere': { prefix: '577', tier: 3 },
};
const CITY_ALIASES = { bangalore: 'Bengaluru', mysore: 'Mysuru', mangalore: 'Mangaluru', hubli: 'Hubballi-Dharwad', hubballi: 'Hubballi-Dharwad', dharwad: 'Hubballi-Dharwad', belgaum: 'Belagavi', tumkur: 'Tumakuru', davangere: 'Davanagere' };
// Cities without a store borrow a buddy store from the nearest city that has one.
const BUDDY_CITY = { 'Tumakuru': 'Bengaluru', 'Davanagere': 'Hubballi-Dharwad' };

// Thresholds the brief doesn't fix. Proposed defaults; the brand must approve them.
export const CONFIG = {
  tierMinLakh: { 1: 30, 2: 20, 3: 15 },
  siteMinSqft: 250,
  idealSqft: [300, 600],
  holdDays: 30,
  reviewDays: 14,
};

// The fixed Sheet 3 from the brief, used when the upload has no stores sheet.
export const DEFAULT_STORES = [
  ['ST-01', 'Bengaluru', '560001', 2019], ['ST-02', 'Bengaluru', '560034', 2020], ['ST-03', 'Bengaluru', '560038', 2021],
  ['ST-04', 'Bengaluru', '560066', 2022], ['ST-05', 'Bengaluru', '560076', 2023], ['ST-06', 'Mysuru', '570009', 2021],
  ['ST-07', 'Mysuru', '570017', 2024], ['ST-08', 'Mangaluru', '575001', 2022], ['ST-09', 'Hubballi-Dharwad', '580020', 2023],
  ['ST-10', 'Belagavi', '590001', 2024],
].map(([id, city, pin, opened]) => ({ id, city, pin, opened }));

export const FRAUD_NOTICE = 'The brand and this platform will never ask you to pay money through personal accounts, agents or any unofficial channel. Any fee appears only in the signed franchise agreement.';

export const STATUS = { APPROVED: 'Approved', CONDITIONAL: 'Conditional', HOLD: 'On hold', WAITLIST: 'Waitlist', REJECTED: 'Not eligible' };
export const STATUS_RANK = { 'Not eligible': 0, 'On hold': 1, 'Waitlist': 2, 'Conditional': 3, 'Approved': 4 };

// ---------- reading the workbook ----------

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const blank = v => v === null || v === undefined || String(v).trim() === '';
const text = v => (blank(v) ? '' : String(v).trim());

export function idNum(id) { const m = String(id).match(/(\d+)/); return m ? Number(m[1]) : Infinity; }
const byId = (a, b) => idNum(a) - idNum(b) || String(a).localeCompare(String(b));

export function parseNumber(v) {
  if (blank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).toLowerCase().replace(/,/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (/crore|\bcr\b/.test(s)) n *= 100;
  return n;
}

export function parsePin(v) {
  if (blank(v)) return '';
  if (typeof v === 'number') return String(Math.round(v));
  return String(v).replace(/\.0+$/, '').replace(/\D/g, '');
}

export function parseCity(v) {
  const s = norm(v);
  if (!s) return '';
  for (const c of Object.keys(CITIES)) if (norm(c) === s || s.startsWith(norm(c))) return c;
  for (const [alias, c] of Object.entries(CITY_ALIASES)) if (s.includes(alias)) return c;
  return null; // given but not one we serve
}

function parseSpace(v) {
  const s = norm(v);
  if (!s) return null;
  if (/not|none|^no|yet/.test(s)) return 'Not yet identified';
  if (/own/.test(s)) return 'Owned';
  if (/rent|lease/.test(s)) return 'Rented';
  return undefined;
}

function parseFloor(v) {
  const s = norm(v);
  if (!s) return null;
  if (/notknown|unknown|notsure/.test(s)) return 'Not known';
  if (/ground|^gf$/.test(s)) return 'Ground';
  if (/mall/.test(s)) return 'Mall unit';
  if (/upper|first|1st|second|2nd|third|3rd/.test(s)) return 'Upper';
  return undefined;
}

const pick = (s, options) => options.find(o => norm(s).includes(norm(o))) || (blank(s) ? '' : null);

// Which header names map to which field. Order matters: first match wins.
const APP_COLUMNS = [
  ['id', h => h.includes('applicationid') || h === 'appid' || h === 'id'],
  ['cityStatePin', h => h.includes('city') && h.includes('pin')],
  ['name', h => h.includes('name')],
  ['city', h => h === 'city' || (h.includes('city') && !h.includes('tier'))],
  ['state', h => h.includes('state')],
  ['pin', h => h.includes('pin')],
  ['investment', h => h.includes('investment')],
  ['experience', h => h.includes('experience')],
  ['business', h => h.includes('business')],
  ['size', h => h.includes('size') || h.includes('sqft')],
  ['space', h => h.includes('space')],
  ['floor', h => h.includes('floor')],
  ['launch', h => h.includes('launch')],
  ['language', h => h.includes('language')],
  ['notes', h => h.includes('note')],
];
const TER_COLUMNS = [
  ['id', h => h.includes('territoryid') || h === 'id'],
  ['pins', h => h.includes('pin')],
  ['tier', h => h.includes('tier')],
  ['city', h => h.includes('city')],
  ['state', h => h.includes('state')],
  ['slots', h => h.includes('slot')],
  ['priority', h => h.includes('priority')],
];
const STORE_COLUMNS = [
  ['id', h => h.includes('storeid') || h === 'id'],
  ['city', h => h.includes('city')],
  ['pin', h => h.includes('pin')],
  ['opened', h => h.includes('open') || h.includes('year')],
];

function mapColumns(headerRow, spec) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = norm(h);
    if (!key) return;
    const hit = spec.find(([field, test]) => !(field in map) && test(key));
    if (hit) map[hit[0]] = i;
  });
  return map;
}

// rows: array of arrays (SheetJS header:1). Finds the header row even under a title row.
function table(rows, marker, spec) {
  const at = rows.findIndex(r => (r || []).some(c => norm(c).includes(marker)));
  if (at < 0) return null;
  const cols = mapColumns(rows[at], spec);
  const out = [];
  rows.slice(at + 1).forEach((r, i) => {
    if (!r || r.every(blank)) return;
    const o = { _row: at + i + 2 };
    for (const [f, idx] of Object.entries(cols)) o[f] = r[idx];
    out.push(o);
  });
  return { cols, rows: out };
}

export function readWorkbook(sheets) {
  const problems = [];
  const names = Object.keys(sheets).filter(n => !/glossary/i.test(n));
  const find = (marker, spec, nameHint) => {
    const ordered = [...names.filter(n => nameHint.test(n)), ...names.filter(n => !nameHint.test(n))];
    for (const n of ordered) { const t = table(sheets[n], marker, spec); if (t) return { ...t, sheet: n }; }
    return null;
  };
  const at = find('applicationid', APP_COLUMNS, /applic/i);
  const tt = find('territoryid', TER_COLUMNS, /territor/i);
  const st = find('storeid', STORE_COLUMNS, /store/i);
  if (!at) problems.push({ fatal: true, text: 'No Applications sheet found (looked for an "Application ID" column).' });
  if (!tt) problems.push({ fatal: true, text: 'No Territories sheet found (looked for a "Territory ID" column).' });
  if (problems.length) return { apps: [], territories: [], stores: DEFAULT_STORES, problems };

  for (const f of ['pin', 'investment', 'space']) if (!(f in at.cols) && !('cityStatePin' in at.cols && f === 'pin'))
    problems.push({ fatal: true, text: `Applications sheet has no column for "${f}".` });
  for (const f of ['pins', 'slots']) if (!(f in tt.cols)) problems.push({ fatal: true, text: `Territories sheet has no column for "${f}".` });

  const seen = {};
  const apps = at.rows.map(r => {
    let city = r.city, state = r.state, pin = r.pin;
    if ('cityStatePin' in at.cols && !blank(r.cityStatePin)) {
      const parts = String(r.cityStatePin).split(/[·,|/]/).map(s => s.trim());
      [city, state, pin] = [parts[0], parts[1], parts.find(p => /\d{3,}/.test(p))];
    }
    let id = text(r.id) || `ROW-${r._row}`;
    seen[id] = (seen[id] || 0) + 1;
    const duplicateOf = seen[id] > 1 ? id : null;
    if (duplicateOf) id = `${id}#${seen[id]}`;
    return {
      id, row: r._row, duplicateOf,
      name: text(r.name),
      cityRaw: text(city), city: parseCity(city), state: text(state),
      pin: parsePin(pin), pinRaw: text(pin),
      investment: parseNumber(r.investment), investmentRaw: text(r.investment),
      experience: parseNumber(r.experience), experienceRaw: text(r.experience),
      business: text(r.business),
      space: parseSpace(r.space), spaceRaw: text(r.space),
      size: parseNumber(r.size), sizeRaw: text(r.size),
      floor: parseFloor(r.floor), floorRaw: text(r.floor),
      launch: parseNumber(r.launch), launchRaw: text(r.launch),
      language: pick(r.language, ['Kannada', 'English', 'Hindi']), languageRaw: text(r.language),
      notes: text(r.notes),
    };
  });

  const territories = tt.rows.map(r => {
    const t = {
      id: text(r.id) || `ROW-${r._row}`,
      city: parseCity(r.city) || text(r.city),
      pins: String(r.pins ?? '').split(/[^0-9.]+/).map(parsePin).filter(Boolean),
      tier: parseNumber(r.tier),
      slots: parseNumber(r.slots),
      priority: pick(r.priority, ['High', 'Medium', 'Low']) || 'Low',
    };
    if (t.slots === null || t.slots < 0) { problems.push({ text: `${t.id}: open slots "${text(r.slots)}" isn't a number; treated as 0.` }); t.slots = 0; }
    t.slots = Math.floor(t.slots);
    const bad = t.pins.filter(p => p.length !== 6);
    if (bad.length) problems.push({ text: `${t.id}: ignored invalid PIN codes ${bad.join(', ')}.` });
    t.pins = t.pins.filter(p => p.length === 6);
    const wrongCity = t.pins.filter(p => CITIES[t.city] && !p.startsWith(CITIES[t.city].prefix));
    if (wrongCity.length) problems.push({ text: `${t.id}: PIN codes ${wrongCity.join(', ')} don't belong to ${t.city}; kept as given.` });
    if (!t.pins.length) problems.push({ text: `${t.id}: no valid PIN codes, so no applicant can match it.` });
    return t;
  });

  const stores = st && st.rows.length
    ? st.rows.map(r => ({ id: text(r.id), city: parseCity(r.city) || text(r.city), pin: parsePin(r.pin), opened: text(r.opened) })).filter(s => s.pin)
    : DEFAULT_STORES;
  if (!st) problems.push({ text: 'No existing-stores sheet in the upload; used the fixed list of 10 stores from the brief.' });

  return { apps, territories, stores, problems };
}

// ---------- validation ----------

const PIN_CITY = Object.fromEntries(Object.entries(CITIES).map(([c, v]) => [v.prefix, c]));
const RETAIL_WORDS = /retail|shop|store|showroom|outlet|optical|optician|eyewear|boutique|franchise|kirana|mart|supermarket|garment|apparel|footwear|counter/;
const fmtL = n => `₹${+n.toFixed(2)} lakh`;

export function validate(a) {
  const issues = []; // {kind: 'missing'|'contradiction', field, text, question}
  const add = (kind, field, text, question) => issues.push({ kind, field, text, question });

  if (a.duplicateOf) add('contradiction', 'id', `Application ID ${a.duplicateOf} appears more than once in the file.`, `Which of the ${a.duplicateOf} rows is the real application?`);
  if (!a.cityRaw) add('missing', 'city', 'City is blank.', 'Which city do you want to open in?');
  else if (a.city === null) add('contradiction', 'city', `City "${a.cityRaw}" is not one of the cities the brand is expanding in.`, 'Which of our cities do you want to open in?');
  if (!a.pin) add('missing', 'pin', 'PIN code is blank.', 'What is the 6-digit PIN code of the location?');
  else if (a.pin.length !== 6) add('contradiction', 'pin', `PIN code "${a.pinRaw}" is not a 6-digit PIN.`, 'What is the correct 6-digit PIN code?');
  else if (a.city && !a.pin.startsWith(CITIES[a.city].prefix)) {
    const other = PIN_CITY[a.pin.slice(0, 3)];
    add('contradiction', 'pin', `PIN ${a.pin} ${other ? `is in ${other}` : 'is outside our cities'}, but the city given is ${a.city}.`, `Is the store meant to be in ${a.city} or ${other || 'somewhere else'}? Please confirm the city and PIN.`);
  }
  if (a.state && !/karnataka/i.test(a.state)) add('contradiction', 'state', `State "${a.state}" doesn't match ${a.city || 'the city'} (Karnataka).`, 'Please confirm the state.');

  if (a.investment === null) add('missing', 'investment', a.investmentRaw ? `Investment "${a.investmentRaw}" isn't a number.` : 'Investment capacity is blank.', 'How much can you invest, in ₹ lakh?');
  else if (a.investment <= 0) add('contradiction', 'investment', `Investment of ${a.investment} isn't possible.`, 'How much can you invest, in ₹ lakh?');
  else if (a.investment > 1000) add('contradiction', 'investment', `Investment of ${a.investmentRaw} lakh looks like a typo (over ₹10 crore).`, 'Please confirm your investment capacity in ₹ lakh.');

  if (a.experience === null) add('missing', 'experience', 'Retail experience is blank.', 'How many years have you run or managed a shop? (0 if none)');
  else if (a.experience < 0 || a.experience > 60) add('contradiction', 'experience', `Retail experience of ${a.experienceRaw} years isn't plausible.`, 'How many years have you run or managed a shop?');
  else if (a.experience === 0 && /\b(run|runs|running|ran|own|owns|manag)/i.test(a.business) && RETAIL_WORDS.test(a.business.toLowerCase()))
    add('contradiction', 'experience', `Retail experience is 0 years, but the business says "${a.business}".`, 'How many years have you run that shop?');

  if (a.space === undefined) add('contradiction', 'space', `Space available "${a.spaceRaw}" isn't Owned, Rented or Not yet identified.`, 'Do you own, rent, or not yet have a space?');
  else if (a.space === null) add('missing', 'space', 'Space available is blank.', 'Do you own, rent, or not yet have a space?');
  else if (a.space === 'Not yet identified') {
    if (a.size !== null && a.size > 0) add('contradiction', 'size', `Says no space yet, but gives a size of ${a.sizeRaw} sq ft.`, 'Do you have a space already? If yes, is it owned or rented?');
    else if (a.floor && a.floor !== 'Not known') add('contradiction', 'floor', `Says no space yet, but gives the floor as ${a.floor}.`, 'Do you have a space already? If yes, is it owned or rented?');
  } else {
    // A blank size or unknown floor is a site-check gap (Conditional), not missing data.
    if (a.size !== null && (a.size < 50 || a.size > 10000)) add('contradiction', 'size', `Space size of ${a.sizeRaw} sq ft looks like a typo.`, 'Please confirm the size of the space in sq ft.');
    if (a.floor === undefined) add('contradiction', 'floor', `Floor "${a.floorRaw}" isn't Ground, Upper, Mall unit or Not known.`, 'Which floor is the space on?');
    if (/(don'?t|do not|yet to|still|no)\s+(have|find|found|got|own)?\s*(a\s+|any\s+)?(shop|space|location|site|premises)|looking for (a |any )?(shop|space|site|location)|searching for (a )?(shop|space|site)/i.test(a.notes))
      add('contradiction', 'space', `Space is marked ${a.space}, but the notes say "${a.notes}".`, 'Do you have a space already, or are you still looking?');
  }

  if (a.launch === null) add('missing', 'launch', 'Target launch is blank.', 'In how many months do you want to open?');
  else if (a.launch < 0 || a.launch > 60) add('contradiction', 'launch', `Target launch of ${a.launchRaw} months isn't plausible.`, 'In how many months do you want to open?');

  const noteAmt = a.notes.match(/(\d+(\.\d+)?)\s*(lakh|lakhs|lac|l\b)/i);
  if (noteAmt && a.investment > 0 && Math.abs(Number(noteAmt[1]) - a.investment) / a.investment > 0.2)
    add('contradiction', 'investment', `Investment is ${fmtL(a.investment)}, but the notes mention ₹${noteAmt[1]} lakh.`, 'Which investment figure is correct?');

  const info = [];
  if (/loan|borrow|emi|finance from/i.test(a.notes)) info.push('Plans to fund part of the investment with a loan; funds must be verified through the lender partner.');
  if (/part[- ]?time|keep (my|the) job|weekends? only|full[- ]time job/i.test(a.notes)) info.push('May not run the store full-time; the brand should discuss this at interview.');
  if (typeof a.investmentRaw === 'string' && a.investment !== null && !/^\d+(\.\d+)?$/.test(a.investmentRaw)) info.push(`Read investment "${a.investmentRaw}" as ${fmtL(a.investment)}.`);
  return { issues, info };
}

// ---------- scoring ----------

export function score(a, territory) {
  const min = CONFIG.tierMinLakh[CITIES[a.city].tier];
  const parts = [];
  const add = (factor, points, max, why) => parts.push({ factor, points: Math.round(points * 100) / 100, max, why });
  add('Investment', 25 * Math.min(1, a.investment / (2 * min)), 25, `${fmtL(a.investment)} vs ${fmtL(min)} minimum; full marks at 2× the minimum`);
  add('Space', { Owned: 15, Rented: 12 }[a.space] || 0, 15, a.space);
  add('Floor', { Ground: 10, 'Mall unit': 8, Upper: 3 }[a.floor] || 0, 10, a.space === 'Not yet identified' ? 'No space yet' : a.floor || 'Not known');
  const [lo, hi] = CONFIG.idealSqft;
  const sz = a.size || 0;
  add('Size', sz >= lo && sz <= hi ? 5 : (sz >= CONFIG.siteMinSqft && sz <= 1000 ? 3 : 0), 5, sz ? `${sz} sq ft (ideal ${lo}–${hi})` : 'No space yet');
  add('Experience', 15 * Math.min(a.experience, 5) / 5, 15, `${a.experience} years (full marks at 5)`);
  const biz = a.business.toLowerCase();
  add('Relevant business', RETAIL_WORDS.test(biz) ? 5 : (biz && !/^(none|nil|na|n\/a|-)$/.test(biz) ? 2 : 0), 5, a.business || 'None given');
  const m = a.launch;
  add('Launch realism', m >= 3 && m <= 6 ? 10 : (m === 2 || (m >= 7 && m <= 9)) ? 6 : (m >= 10 && m <= 12) ? 4 : 2, 10, `${m} months (3–6 is realistic)`);
  add('Territory priority', { High: 10, Medium: 6, Low: 3 }[territory.priority], 10, `${territory.id} is ${territory.priority} priority`);
  const fields = [a.name, a.business, a.language, a.notes];
  add('Completeness', 5 * fields.filter(Boolean).length / fields.length, 5, `${fields.filter(Boolean).length} of ${fields.length} optional fields filled`);
  return { total: Math.round(parts.reduce((s, p) => s + p.points, 0) * 100) / 100, parts };
}

// ---------- deciding ----------

export function decide({ apps, territories, stores }) {
  const storeByPin = Object.fromEntries(stores.map(s => [s.pin, s]));
  const prioRank = { High: 0, Medium: 1, Low: 2 };
  const terrSorted = [...territories].sort((x, y) => prioRank[x.priority] - prioRank[y.priority] || byId(x.id, y.id));
  const terrByPin = {};
  for (const t of terrSorted) for (const p of t.pins) if (!terrByPin[p]) terrByPin[p] = t; // a PIN in two territories goes to the higher-priority one

  const out = {};
  const candidates = {}; // territory id -> decisions competing for it

  for (const a of [...apps].sort((x, y) => byId(x.id, y.id))) {
    const { issues, info } = validate(a);
    const d = out[a.id] = { id: a.id, app: a, checks: [], info, issues, questions: [], alternatives: [], levers: [] };
    const check = (name, pass, detail) => d.checks.push({ name, pass, detail });

    if (issues.length) {
      check('Data complete and consistent', false, issues.map(i => i.text).join(' '));
      d.status = STATUS.HOLD;
      d.questions = [...new Set(issues.map(i => i.question))];
      d.headline = issues[0].text + (issues.length > 1 ? ` (+${issues.length - 1} more issue${issues.length > 2 ? 's' : ''})` : '');
      continue;
    }
    check('Data complete and consistent', true, 'All required fields present; city, PIN and space details agree.');

    const tier = CITIES[a.city].tier, min = CONFIG.tierMinLakh[tier];
    if (a.investment < min) {
      check('Investment meets city-tier minimum', false, `${fmtL(a.investment)} is below the Tier ${tier} minimum of ${fmtL(min)}.`);
      d.status = STATUS.REJECTED;
      d.gap = min - a.investment;
      d.headline = `Investment of ${fmtL(a.investment)} is ${fmtL(d.gap)} short of the ${fmtL(min)} minimum for Tier ${tier} ${a.city}.`;
      const cheaper = Object.entries(CITIES).filter(([, v]) => CONFIG.tierMinLakh[v.tier] <= a.investment).map(([c]) => c);
      d.levers.push(`Show at least ${fmtL(min)} available (${fmtL(d.gap)} more), for example with a sanctioned loan verified by our lender partner.`);
      if (cheaper.length) d.levers.push(`Or apply in a city where the minimum fits your budget: ${cheaper.join(', ')}.`);
      continue;
    }
    check('Investment meets city-tier minimum', true, `${fmtL(a.investment)} vs ${fmtL(min)} Tier ${tier} minimum (as stated by the applicant; not yet verified).`);

    const t = terrByPin[a.pin];
    if (!t) {
      check('PIN is inside a territory', false, `PIN ${a.pin} is not in any territory the brand is opening.`);
      d.status = STATUS.WAITLIST;
      d.headline = `PIN ${a.pin} is not in any territory the brand is currently opening.`;
      d.reason = 'no-territory';
      continue;
    }
    check('PIN is inside a territory', true, `PIN ${a.pin} is in ${t.id} (${t.city}, ${t.priority} priority, ${t.slots} open slot${t.slots === 1 ? '' : 's'}).`);
    d.territory = t.id;

    const store = storeByPin[a.pin];
    if (store) {
      check('PIN has no existing store', false, `Existing store ${store.id} already operates in PIN ${a.pin}.`);
      d.status = STATUS.WAITLIST;
      d.headline = `PIN ${a.pin} already has store ${store.id}; the brand never opens two stores in one PIN.`;
      d.reason = 'pin-store';
      continue;
    }
    check('PIN has no existing store', true, `No existing store in PIN ${a.pin}.`);

    d.score = score(a, t);
    (candidates[t.id] ||= []).push(d);
  }

  // Allocation: territories in priority order; within each, score desc then ID. Independent of row order.
  const terrState = {};
  for (const t of terrSorted) {
    const list = (candidates[t.id] || []).sort((x, y) => y.score.total - x.score.total || byId(x.id, y.id));
    const taken = {}; // pin -> app id
    const winners = [];
    list.forEach((d, i) => {
      d.rank = i + 1;
      d.rankOf = list.length;
      if (taken[d.app.pin]) {
        d.status = STATUS.WAITLIST; d.reason = 'pin-applicant'; d.pinTakenBy = taken[d.app.pin];
        d.checks.push({ name: 'Wins a slot in the territory', pass: false, detail: `PIN ${d.app.pin} went to ${taken[d.app.pin]}, who ranks higher (one store per PIN).` });
        d.headline = `PIN ${d.app.pin} went to ${taken[d.app.pin]}, who ranks higher; only one store per PIN.`;
      } else if (winners.length >= t.slots) {
        d.status = STATUS.WAITLIST; d.reason = 'slots-full';
        d.checks.push({ name: 'Wins a slot in the territory', pass: false, detail: t.slots === 0 ? `${t.id} has no open slots.` : `${t.id}'s ${t.slots} slot${t.slots === 1 ? '' : 's'} went to higher-ranked applicants (${winners.map(w => w.id).join(', ')}).` });
        d.headline = t.slots === 0 ? `${t.id} has no open slots right now.` : `Ranked ${d.rank} of ${list.length} in ${t.id}, which has ${t.slots} slot${t.slots === 1 ? '' : 's'}.`;
      } else {
        taken[d.app.pin] = d.id; winners.push(d);
        d.checks.push({ name: 'Wins a slot in the territory', pass: true, detail: `Ranked ${d.rank} of ${list.length} in ${t.id} (score ${d.score.total}/100); slot ${winners.length} of ${t.slots}.` });
        const a = d.app, gaps = siteGaps(a);
        d.checks.push({ name: 'Site ready', pass: !gaps.length, detail: gaps.length ? gaps.join(' ') : `${a.space} ${a.size} sq ft, ${a.floor.toLowerCase()} floor.` });
        if (gaps.length) {
          d.status = STATUS.CONDITIONAL; d.siteGaps = gaps;
          d.headline = `Wins a slot in ${t.id} (rank ${d.rank}), but the site isn't ready: ${gaps[0].charAt(0).toLowerCase() + gaps[0].slice(1)}`;
        } else {
          d.status = STATUS.APPROVED;
          d.headline = `Wins a slot in ${t.id} (rank ${d.rank} of ${list.length}, score ${d.score.total}) with a ready site in PIN ${a.pin}.`;
        }
      }
    });
    terrState[t.id] = { territory: t, winners: winners.map(w => w.id), candidates: list.map(d => d.id), taken };
  }

  // Alternatives and levers need the final allocation.
  const allocated = new Set(Object.values(terrState).flatMap(s => Object.keys(s.taken)));
  const freePins = t => t.pins.filter(p => !storeByPin[p] && !allocated.has(p));
  const openSlots = t => t.slots - terrState[t.id].winners.length;
  for (const d of Object.values(out)) {
    if (d.status !== STATUS.WAITLIST) continue;
    const a = d.app, t = territories.find(x => x.id === d.territory);
    const sameCity = territories.filter(x => x.city === a.city && openSlots(x) > 0 && freePins(x).length);
    if (d.reason === 'no-territory' || d.reason === 'pin-store' || d.reason === 'pin-applicant') {
      for (const x of sameCity) d.alternatives.push(`${x.id} (${x.city}) has ${openSlots(x)} open slot${openSlots(x) === 1 ? '' : 's'}; unused PINs: ${freePins(x).join(', ')}.`);
      if (d.reason === 'pin-applicant' && t && openSlots(t) <= 0) {
        const last = terrState[t.id].winners.map(id => out[id]).at(-1);
        if (last && d.score.total > last.score.total && freePins(t).length)
          d.levers.push(`With a site in an unused PIN in ${t.id} (${freePins(t).join(', ')}), your score of ${d.score.total} would beat ${last.id} (${last.score.total}) for a slot.`);
      }
    }
    if (d.reason === 'slots-full' && t) {
      const winners = terrState[t.id].winners.map(id => out[id]);
      const last = winners.at(-1);
      if (last) {
        const need = last.score.total - d.score.total;
        d.levers.push(`Needs ${+need.toFixed(2)} more points to pass ${last.id} (score ${last.score.total}), the lowest-ranked slot winner in ${t.id}.`);
        for (const l of improvements(a, t)) if (l.gain > need) d.levers.push(`${l.text} (+${+l.gain.toFixed(2)} points) would be enough.`);
      }
      for (const x of sameCity.filter(x => x.id !== t.id)) d.alternatives.push(`${x.id} (${x.city}) has ${openSlots(x)} open slot${openSlots(x) === 1 ? '' : 's'}; unused PINs: ${freePins(x).join(', ')}.`);
    }
    if (!d.alternatives.length && !d.levers.length) d.levers.push('Stays on the waitlist and is offered the next slot that opens in this city.');
  }

  for (const d of Object.values(out)) d.plan = plan(d, stores);
  return { decisions: out, territories: terrState, generatedFor: apps.length };
}

function siteGaps(a) {
  const g = [];
  if (a.space === 'Not yet identified') g.push(`No space identified yet; needs a ground-floor or mall unit of ${CONFIG.idealSqft[0]}–${CONFIG.idealSqft[1]} sq ft in PIN ${a.pin}.`);
  else {
    if (a.floor === 'Upper') g.push('Space is on an upper floor; the store needs a ground-floor or mall unit.');
    else if (a.floor !== 'Ground' && a.floor !== 'Mall unit') g.push('Floor not known; confirm the space is on the ground floor or in a mall.');
    if (a.size === null) g.push(`Size not given; confirm the space is at least ${CONFIG.siteMinSqft} sq ft.`);
    else if (a.size < CONFIG.siteMinSqft) g.push(`Space is ${a.size} sq ft; the minimum is ${CONFIG.siteMinSqft} sq ft.`);
  }
  return g;
}

function improvements(a, t) {
  const base = score(a, t).total;
  const tryWith = (patch, text) => ({ text, gain: score({ ...a, ...patch }, t).total - base });
  const opts = [];
  if (a.floor !== 'Ground') opts.push(tryWith({ floor: 'Ground', space: a.space === 'Not yet identified' ? 'Rented' : a.space, size: a.size || CONFIG.idealSqft[0] }, a.space === 'Not yet identified' ? 'Finding a rented ground-floor space' : 'Moving to a ground-floor space'));
  if (a.space !== 'Owned' && a.space !== 'Not yet identified') opts.push(tryWith({ space: 'Owned' }, 'Owning the space instead of renting'));
  if (a.investment < 2 * CONFIG.tierMinLakh[CITIES[a.city].tier]) opts.push(tryWith({ investment: 2 * CONFIG.tierMinLakh[CITIES[a.city].tier] }, `Raising investment to ${fmtL(2 * CONFIG.tierMinLakh[CITIES[a.city].tier])}`));
  return opts.filter(o => o.gain > 0).sort((x, y) => y.gain - x.gain);
}

// ---------- onboarding ----------

const WEEK = { agreement: [1, 2], licences: [2, 6], fitout: [4, 9], training: [7, 10], open: 11 };

function buddyStore(a, stores) {
  const city = stores.some(s => s.city === a.city) ? a.city : BUDDY_CITY[a.city];
  const inCity = stores.filter(s => s.city === city);
  if (!inCity.length) return null;
  // shortcut: nearest by PIN number within the city, not by road distance; use PIN centroids once loaded.
  return inCity.reduce((best, s) => Math.abs(+s.pin - +a.pin) < Math.abs(+best.pin - +a.pin) ? s : best);
}

export function plan(d, stores) {
  const a = d.app;
  const lang = a.language || 'English';
  if (d.status === STATUS.HOLD) return { steps: d.questions.map(q => ({ text: q, owner: 'Applicant', state: 'Outstanding' })), message: msg(a, `We need a few answers before we can assess your application:\n${d.questions.map(q => `• ${q}`).join('\n')}`) };
  if (d.status === STATUS.REJECTED) return { steps: d.levers.map(t => ({ text: t, owner: 'Applicant', state: 'Suggested' })), message: msg(a, `Thank you for applying. ${d.headline} ${d.levers.join(' ')}`) };
  if (d.status === STATUS.WAITLIST) return { steps: [...d.alternatives, ...d.levers].map(t => ({ text: t, owner: 'Applicant', state: 'Suggested' })), message: msg(a, `You're on our waitlist. ${d.headline} ${[...d.alternatives, ...d.levers].join(' ')}`) };

  const shift = d.status === STATUS.CONDITIONAL ? 4 : 0; // site search comes first
  const w = ([s, e]) => `Weeks ${s + shift}–${e + shift}`;
  const exp = a.experience;
  const track = exp === 0 ? ['Foundation track', 3, 'retail basics, billing and stock, customer service, brand standards']
    : exp <= 3 ? ['Standard track', 2, 'brand systems, stock and merchandising, staff management']
    : ['Fast track', 1, 'brand systems and standards'];
  const buddy = buddyStore(a, stores);
  const steps = [
    { text: 'Screening passed and slot allocated', owner: 'Platform', state: 'Completed' },
    { text: 'Brand reviews and signs off on this partner', owner: 'Brand', state: 'Needs brand approval' },
  ];
  if (d.status === STATUS.CONDITIONAL) steps.push({ text: `Find a site within ${CONFIG.holdDays} days (slot held until then): ${d.siteGaps.join(' ')}`, owner: 'Applicant', state: 'Outstanding', when: 'Weeks 1–4' });
  steps.push(
    { text: 'Verify identity through DigiLocker (via licensed vendor), with consent', owner: 'Applicant', state: 'Outstanding', when: `Week ${1 + shift}` },
    { text: `Verify funds of at least ${fmtL(CONFIG.tierMinLakh[CITIES[a.city].tier])} through the lender partner (attestation only; no bank statements shared with the brand)`, owner: 'Applicant', state: 'Outstanding', when: `Week ${1 + shift}` },
    { text: 'Submit lease or ownership document; brand approves the site', owner: 'Applicant → Brand', state: 'Needs brand approval', when: `Week ${1 + shift}` },
    { text: `Franchise agreement shared; ${CONFIG.reviewDays}-day review before signing or paying anything`, owner: 'Brand → Applicant', state: 'Outstanding', when: w(WEEK.agreement) },
    { text: `Licences: Karnataka Shops & Commercial Establishments registration, trade licence from the ${a.city} city corporation, GST registration, signage permission`, owner: 'Applicant', state: 'Outstanding', when: w(WEEK.licences) },
    { text: 'Store fit-out to brand layout and signage', owner: 'Applicant + Brand projects team', state: 'Outstanding', when: w(WEEK.fitout) },
    { text: `${track[0]} training in ${lang}: ${track[1]} week${track[1] > 1 ? 's' : ''} (${track[2]})`, owner: 'Brand training team', state: 'Suggested', when: w(WEEK.training) },
    { text: buddy ? `Buddy store: ${buddy.id} (${buddy.city}, PIN ${buddy.pin}); shadow shifts there before opening` : 'Buddy store: none nearby; assign a remote mentor', owner: 'Brand', state: 'Suggested', when: w(WEEK.training) },
    { text: 'Check-ins at day 7, 30, 60 and 90 after opening (sales, stock, staffing, customer feedback)', owner: 'Brand area manager', state: 'Suggested', when: `From week ${WEEK.open + shift}` },
  );
  const weeks = WEEK.open + shift;
  const notes = [];
  if (a.launch * 4.3 < weeks) notes.push(`Target launch of ${a.launch} month${a.launch === 1 ? '' : 's'} is tighter than this ~${weeks}-week plan; agree a realistic date.`);
  const message = msg(a, d.status === STATUS.APPROVED
    ? `Good news: your application for PIN ${a.pin} has passed screening and a slot is reserved for you, subject to the brand's final approval and verification. Next: verify your identity and funds, then you'll receive the franchise agreement with ${CONFIG.reviewDays} days to review it before signing or paying anything. Training will be in ${lang}.`
    : `Your application for PIN ${a.pin} has passed screening and we're holding a slot for ${CONFIG.holdDays} days while you find a suitable site: ${d.siteGaps.join(' ')}`);
  return { steps, notes, weeks, message };
}

const msg = (a, body) => `Dear ${a.name || 'applicant'},\n\n${body}\n\n${FRAUD_NOTICE}`;

// ---------- follow-ups ----------

export const FIELD_LABEL = { investment: 'Investment (₹ lakh)', experience: 'Retail experience (years)', space: 'Space available', size: 'Space size (sq ft)', floor: 'Floor', launch: 'Target launch (months)', pin: 'PIN code', city: 'City', language: 'Preferred language', business: 'Current / past business' };

function findApp(textIn, apps) {
  const m = textIn.match(/\b(?:app(?:lication)?)[\s#-]*0*(\d+)\b/i);
  if (!m) return { missing: true };
  const n = Number(m[1]);
  const hits = apps.filter(a => idNum(a.id) === n);
  return hits.length ? { app: hits[0], asked: m[0] } : { unknown: `APP-${String(n).padStart(3, '0')}` };
}

export function interpret(input, apps, result) {
  const q = input.trim();
  const lower = q.toLowerCase();
  const terr = q.match(/\bter[\s-]*0*(\d+)\b/i);
  if (terr && !/app/i.test(q)) {
    const s = Object.values(result.territories).find(x => idNum(x.territory.id) === Number(terr[1]));
    if (!s) return { type: 'clarify', text: `There's no territory TER-${terr[1].padStart(2, '0')} in this file.` };
    const t = s.territory;
    return { type: 'answer', text: `${t.id} (${t.city}, ${t.priority} priority) has ${t.slots} slot${t.slots === 1 ? '' : 's'}. ${s.winners.length ? `Slots went to ${s.winners.map(id => `${id} (${result.decisions[id].status}, score ${result.decisions[id].score.total})`).join(', ')}.` : 'No slots allocated.'} ${s.candidates.length > s.winners.length ? `Waitlisted: ${s.candidates.filter(id => !s.winners.includes(id)).join(', ')}.` : ''}` };
  }

  const f = findApp(q, apps);
  if (f.missing) return { type: 'clarify', text: 'Which application do you mean? Please include its ID, like APP-007.' };
  if (f.unknown) return { type: 'clarify', text: `There's no ${f.unknown} in this file. Check the ID and try again.` };
  const a = f.app, d = result.decisions[a.id];

  const changes = parseChanges(lower, a);
  const isUpdate = changes.length || /\b(now|found|has|got|secured|moved|changed|increased|raised|update|instead|actually|correct(ion)?|withdr)/.test(lower) && !/\b(why|what|how|explain|status)\b/.test(lower);
  if (changes.length) {
    const assumptions = changes.filter(c => c.assumed).map(c => c.assumed);
    return { type: 'proposal', app: a.id, changes: changes.map(({ field, to }) => ({ field, from: a[field], to })), assumptions };
  }
  if (isUpdate) return { type: 'clarify', text: `I couldn't tell which detail of ${a.id} changed. I can update: ${Object.values(FIELD_LABEL).join(', ')}. For example: "${a.id} now has a 400 sq ft ground-floor space" or "${a.id} can invest 30 lakh".` };

  if (/what would|what does .* need|need to|how can|how could|move forward|to progress|what change|improve|get approved/.test(lower)) return { type: 'answer', text: needs(d) };
  return { type: 'answer', text: why(d) };
}

function parseChanges(s, a) {
  const c = [];
  const set = (field, to, assumed) => { if (to !== a[field] && to !== undefined) c.push({ field, to, assumed }); };
  const floor = /ground[\s-]*floor|\bground\b/.test(s) ? 'Ground' : /\bmall\b/.test(s) ? 'Mall unit' : /(upper|first|second|1st|2nd)[\s-]*floor/.test(s) ? 'Upper' : undefined;
  const foundSpace = /(found|got|secured|identified|has (a |an )?(new )?(shop|space|site|unit)|now has|rented|leased|bought|purchased)/.test(s);
  if (/\b(bought|purchased|owns|owned|own)\b/.test(s)) set('space', 'Owned');
  else if (/\b(rent|rented|lease|leased)\b/.test(s)) set('space', 'Rented');
  else if ((floor || foundSpace) && a.space === 'Not yet identified' && /space|shop|site|unit|floor/.test(s)) set('space', 'Rented', 'Assumed the new space is rented. Say "owned" if it is owned.');
  else if (/no longer has|lost (the|their) (space|shop)|not yet identified/.test(s)) set('space', 'Not yet identified');
  if (floor) set('floor', floor);
  const size = s.match(/(\d[\d,]*)\s*(sq\.?\s*ft|sqft|square\s*feet|sq\.?\s*feet)/);
  if (size) set('size', Number(size[1].replace(/,/g, '')));
  const money = s.match(/(\d+(\.\d+)?)\s*(lakh|lakhs|lac|l\b|crore|cr\b)/);
  if (money) set('investment', Number(money[1]) * (/cr/.test(money[3]) ? 100 : 1));
  const exp = s.match(/(\d+)\s*years?/);
  if (exp && /experience|years? (of|in|running|managing)/.test(s)) set('experience', Number(exp[1]));
  const launch = s.match(/(\d+)\s*months?/);
  if (launch && /launch|open|months? (from|time)|in \d+ months/.test(s)) set('launch', Number(launch[1]));
  const pin = s.match(/\b(\d{6})\b/);
  if (pin) set('pin', pin[1]);
  for (const city of Object.keys(CITIES)) if (s.includes(city.toLowerCase())) set('city', city);
  for (const lang of ['Kannada', 'English', 'Hindi']) if (s.includes(lang.toLowerCase()) && /language|train|speak|prefer/.test(s)) set('language', lang);
  return c;
}

export function applyChanges(apps, id, changes) {
  return apps.map(a => {
    if (a.id !== id) return a;
    const b = { ...a };
    for (const { field, to } of changes) {
      b[field] = to;
      if (`${field}Raw` in b) b[`${field}Raw`] = to === null ? '' : String(to);
      if (field === 'space' && to === 'Not yet identified') { b.size = null; b.sizeRaw = ''; b.floor = 'Not known'; b.floorRaw = 'Not known'; }
    }
    if (changes.some(c => c.field === 'pin') && !changes.some(c => c.field === 'city')) {
      const c = PIN_CITY[String(b.pin).slice(0, 3)];
      if (c) { b.city = c; b.cityRaw = c; }
    }
    return b;
  });
}

export function diff(before, after) {
  return Object.keys(after.decisions).filter(id => before.decisions[id]).map(id => {
    const x = before.decisions[id], y = after.decisions[id];
    return { id, from: x.status, to: y.status, why: y.headline, changed: x.status !== y.status || x.headline !== y.headline };
  }).filter(r => r.changed);
}

export function why(d) {
  const failed = d.checks.find(c => c.pass === false);
  const lines = [`${d.id} is ${d.status === STATUS.WAITLIST ? 'on the waitlist' : d.status}. ${d.headline}`];
  if (failed) lines.push(`First check that failed: ${failed.name}. ${failed.detail}`);
  if (d.score) lines.push(`Score ${d.score.total}/100: ${d.score.parts.map(p => `${p.factor} ${p.points}/${p.max}`).join(', ')}.`);
  if (d.info.length) lines.push(d.info.join(' '));
  return lines.join('\n');
}

export function needs(d) {
  const s = d.status;
  if (s === STATUS.APPROVED) return `${d.id} is already moving forward. Remaining steps: brand sign-off, identity and funds verification, then the agreement (${CONFIG.reviewDays}-day review), licences, fit-out and training.`;
  if (s === STATUS.CONDITIONAL) return `${d.id} holds a slot for ${CONFIG.holdDays} days. To become Approved: ${d.siteGaps.join(' ')}`;
  if (s === STATUS.HOLD) return `${d.id} needs these answered before it can be assessed:\n${d.questions.map(q => `• ${q}`).join('\n')}`;
  return `${d.id} (${s}): ${[...d.levers, ...d.alternatives].join(' ') || 'Nothing the applicant can change right now; a slot must open.'}`;
}
