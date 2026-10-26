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
  launchMaxMonths: 12,
  // Outside these ranges a value goes to "please confirm" instead of being scored.
  plausible: { investment: [1, 200], size: [50, 3000], experience: [0, 60], launch: [0, 60] },
};

// The fixed Sheet 3 from the brief, used when the upload has no stores sheet.
export const DEFAULT_STORES = [
  ['ST-01', 'Bengaluru', '560001', 2019], ['ST-02', 'Bengaluru', '560034', 2020], ['ST-03', 'Bengaluru', '560038', 2021],
  ['ST-04', 'Bengaluru', '560066', 2022], ['ST-05', 'Bengaluru', '560076', 2023], ['ST-06', 'Mysuru', '570009', 2021],
  ['ST-07', 'Mysuru', '570017', 2024], ['ST-08', 'Mangaluru', '575001', 2022], ['ST-09', 'Hubballi-Dharwad', '580020', 2023],
  ['ST-10', 'Belagavi', '590001', 2024],
].map(([id, city, pin, opened]) => ({ id, city, pin, opened }));

export const FRAUD_NOTICE = 'The brand and this platform will never ask you to pay money through personal accounts, agents or any unofficial channel. Any fee appears only in the signed franchise agreement.';

export const STATUS = { APPROVED: 'Approved', REVIEW: 'Brand review', CONDITIONAL: 'Conditional', HOLD: 'On hold', WAITLIST: 'Waitlist', REJECTED: 'Not eligible', WITHDRAWN: 'Withdrawn' };
export const STATUS_RANK = { 'Withdrawn': -1, 'Not eligible': 0, 'On hold': 1, 'Waitlist': 2, 'Conditional': 3, 'Brand review': 3, 'Approved': 4 };
const WINNING = new Set([STATUS.APPROVED, STATUS.REVIEW, STATUS.CONDITIONAL]);
export const isWinner = d => WINNING.has(d.status);

export const pl = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtL = n => `₹${+n.toFixed(2)} lakh`;

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
      confirmed: [],
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
  const prioRank = { High: 0, Medium: 1, Low: 2 };
  const owners = {};
  for (const t of territories) for (const p of t.pins) (owners[p] ||= []).push(t);
  for (const [p, ts] of Object.entries(owners)) if (ts.length > 1) {
    const win = [...ts].sort((x, y) => prioRank[x.priority] - prioRank[y.priority] || byId(x.id, y.id))[0];
    problems.push({ text: `PIN ${p} is listed in ${ts.map(t => t.id).join(' and ')}; it is treated as part of ${win.id} (higher priority, then lower ID).` });
  }

  const stores = st && st.rows.length
    ? st.rows.map(r => ({ id: text(r.id), city: parseCity(r.city) || text(r.city), pin: parsePin(r.pin), opened: text(r.opened) })).filter(s => s.pin)
    : DEFAULT_STORES;
  if (!st) problems.push({ text: 'No existing-stores sheet in the upload; used the fixed list of 10 stores from the brief.' });

  return { apps, territories, stores, problems };
}

// ---------- reading free text ----------
// shortcut: rule-based reading of notes, built on meaning-level word groups rather than exact phrases; replace with Gemini extraction (F3) once the server route exists.

const sentences = s => String(s || '').split(/(?<=[.!?;])\s+|\n+/).filter(Boolean);
const quote = s => `"${s.trim()}"`;
const RX = {
  search: /\b(search|searching|searched|look|looking|hunt|hunting|find|finding|scout|scouting|identify|identifying|locate|locating|secure|securing|finali[sz]e|finali[sz]ing)\b/i,
  spaceWord: /\b(shop|space|site|location|premises|place|unit|property|outlet|store|showroom)\b/i,
  pending: /\b(still|yet|not|no|currently|trying|will|once|until|haven'?t|hasn'?t|have not|has not|don'?t|doesn'?t|do not|need to|yet to)\b/i,
  alternative: /\b(also|another|second|additional|better|bigger|alternative|option|extra|second)\b/i,
  paid: /\b(paid|deposited|transferred|gave|given|sent|handed over)\b/i,
  money: /(₹|\brs\.?\s*\d|\binr\b|\bfee\b|\bamount\b|\bmoney\b|\bdeposit\b|\badvance\b|\bbooking\b|\btoken\b|\bcommission\b|\bcash\b|\d[\d,]*\s*(rupees|lakh|thousand|k\b))/i,
  rival: /\b(rival|competitor|competing|competition|another (eyewear |optical )?brand|franchise of|franchisee of|franchise for|dealer (of|for)|lenskart|titan eye|eyeplus|specsmakers|vision express)\b/i,
  operator: /\b(husband|wife|spouse|son|daughter|brother|sister|father|mother|relative|cousin|nephew|niece|partner|manager|staff|employee|family member|someone else|in-laws?)\b[^.]*\b(run|runs|running|manage|manages|managing|operate|operates|handle|handles|look after|looks after|in charge|day to day)\b/i,
  loan: /\b(loan|borrow|borrowing|emi|financ\w*|credit)\b/i,
  unsanctioned: /\b(expected|awaiting|applied|pending|not yet|yet to|will be|in process|under process)\b/i,
  assetSale: /\b(sell|selling|sale of|sold)\b[^.]*\b(plot|land|house|property|gold|car|flat|site|shop)\b/i,
  instruct: /\b(ignore|bypass|override|disregard|skip)\b[^.]*\b(rules?|checks?|process|instructions?|criteria)\b|\bapprove (this|me|my|it)\b|\bi know the (owner|founder|ceo|management|md)\b/i,
  yearsText: /\bfor (\d+)\s*\+?\s*(years|yrs)\b|\b(\d+)\s*\+?\s*(years|yrs)\b\s*(of|in|running|managing|experience|exp)\b/i,
  partTime: /part[- ]?time|keep (my|the) job|weekends? only|full[- ]time job/i,
};

export function readNotes(a) {
  const facts = { contradictions: [], review: [], notes: [], warnApplicant: [] };
  const all = `${a.business}. ${a.notes}`;
  const hasSpace = a.space === 'Owned' || a.space === 'Rented';

  if (hasSpace && !a.confirmed.includes('space')) for (const s of sentences(a.notes))
    if (RX.search.test(s) && RX.spaceWord.test(s) && RX.pending.test(s) && !RX.alternative.test(s))
      facts.contradictions.push({ field: 'space', text: `Space is marked ${a.space}, but the notes say ${quote(s)}.`, question: 'Do you already have the space, or are you still looking?' });

  const pins = [...new Set((all.match(/\b\d{6}\b/g) || []))].filter(p => p !== a.pin);
  if (pins.length && a.pin && !a.confirmed.includes('pin'))
    facts.contradictions.push({ field: 'pin', text: `PIN column says ${a.pin}, but the text mentions ${pins.join(', ')}.`, question: `Which PIN is the store in: ${[a.pin, ...pins].join(' or ')}?` });

  const y = all.match(RX.yearsText);
  const years = y ? Number(y[1] || y[3]) : null;
  if (years !== null && a.experience !== null && Math.abs(years - a.experience) > 2 && !a.confirmed.includes('experience'))
    facts.contradictions.push({ field: 'experience', text: `Retail experience is ${pl(a.experience, 'year')}, but the text says ${quote(y[0])} (${quote(a.business && a.business.includes(y[0]) ? a.business : a.notes)}).`, question: 'How many years have you run or managed a shop?' });
  else if (a.experience === 0 && /\b(run|runs|running|ran|own|owns|manag)/i.test(a.business) && /retail|shop|store|showroom|outlet|optical|boutique|kirana|mart|counter/i.test(a.business) && !a.confirmed.includes('experience'))
    facts.contradictions.push({ field: 'experience', text: `Retail experience is 0 years, but the business says ${quote(a.business)}.`, question: 'How many years have you run that shop?' });

  const noteAmt = a.notes.match(/(\d+(\.\d+)?)\s*(lakh|lakhs|lac|l\b)/i);
  if (noteAmt && a.investment > 0 && Math.abs(Number(noteAmt[1]) - a.investment) / a.investment > 0.2 && !a.confirmed.includes('investment'))
    facts.contradictions.push({ field: 'investment', text: `Investment is ${fmtL(a.investment)}, but the notes mention ₹${noteAmt[1]} lakh.`, question: 'Which investment figure is correct?' });

  for (const s of sentences(all)) {
    if (RX.paid.test(s) && RX.money.test(s)) {
      facts.review.push({ kind: 'fraud', text: `Says money was already paid: ${quote(s)}. The brand never takes payment through agents; possible fraud. The brand must check this before any approval.` });
      facts.warnApplicant.push('You mentioned paying money to someone for this application. The brand has not asked for any payment; please do not pay anyone and report who asked you.');
    }
    if (RX.rival.test(s)) facts.review.push({ kind: 'conflict', text: `Possible conflict of interest: ${quote(s)}. The brand should decide whether this is acceptable.` });
    if (RX.operator.test(s)) facts.review.push({ kind: 'operator', text: `Someone other than the applicant may run the store: ${quote(s)}. Ask who the operator is and whether they will be trained.` });
    if (RX.instruct.test(s)) facts.notes.push(`The notes try to influence the decision (${quote(s)}); this was ignored. Decisions use only the application's facts.`);
    if (RX.assetSale.test(s)) facts.notes.push(`Funds depend on selling an asset (${quote(s)}); verify before the agreement.`);
    if (RX.partTime.test(s)) facts.notes.push(`May not run the store full-time (${quote(s)}); discuss at interview.`);
  }
  if (RX.loan.test(all)) facts.notes.push(RX.unsanctioned.test(all)
    ? 'Part of the money depends on a loan that is not yet sanctioned; investment is stated, not verified, until the lender partner confirms it.'
    : 'Plans to use a loan; funds must be verified through the lender partner.');
  if (/[ಀ-೿]/.test(all)) facts.notes.push('Some text is in Kannada, which the rule-based checks cannot read; a Kannada-speaking reviewer should check it.');
  if (/[ऀ-ॿ]/.test(all)) facts.notes.push('Some text is in Hindi, which the rule-based checks cannot read; a Hindi-speaking reviewer should check it.');
  const dedupe = list => list.filter((x, i) => list.findIndex(y => (y.text || y) === (x.text || x)) === i);
  for (const k of Object.keys(facts)) facts[k] = dedupe(facts[k]);
  return facts;
}

// ---------- validation ----------

const PIN_CITY = Object.fromEntries(Object.entries(CITIES).map(([c, v]) => [v.prefix, c]));
const RETAIL_WORDS = /retail|shop|store|showroom|outlet|optical|optician|eyewear|boutique|franchise|kirana|mart|supermarket|garment|apparel|footwear|counter|pharmacy|grocery|bakery|parlour|tailor/;

export function validate(a) {
  const issues = []; // {kind: 'missing'|'contradiction'|'confirm', field, text, question}
  const add = (kind, field, text, question) => issues.push({ kind, field, text, question });
  const range = (field, label, unit) => {
    const [lo, hi] = CONFIG.plausible[field];
    const v = a[field];
    if (v !== null && v !== undefined && (v < lo || v > hi) && !a.confirmed.includes(field))
      add('confirm', field, `${label} of ${a[`${field}Raw`] || v}${unit} is outside the usual range (${lo}–${hi}${unit}); please confirm it before it is scored.`, `Please confirm your ${label.toLowerCase()}${unit ? ` in${unit}` : ''}.`);
  };

  if (a.duplicateOf) add('contradiction', 'id', `Application ID ${a.duplicateOf} appears more than once in the file.`, `Which of the ${a.duplicateOf} rows is the real application?`);
  if (!a.cityRaw) add('missing', 'city', 'City is blank.', 'Which city do you want to open in?');
  else if (a.city === null) add('contradiction', 'city', `City "${a.cityRaw}" is not one of the cities the brand is expanding in.`, 'Which of our cities do you want to open in?');
  if (!a.pin) add('missing', 'pin', 'PIN code is blank.', 'What is the 6-digit PIN code of the location?');
  else if (a.pin.length !== 6) add('contradiction', 'pin', `PIN code "${a.pinRaw}" is not a 6-digit PIN.`, 'What is the full 6-digit PIN code?');
  else if (a.city && !a.pin.startsWith(CITIES[a.city].prefix)) {
    const other = PIN_CITY[a.pin.slice(0, 3)];
    add('contradiction', 'pin', `PIN ${a.pin} ${other ? `is in ${other}` : 'is outside our cities'}, but the city given is ${a.city}.`, `Is the store meant to be in ${a.city} or ${other || 'somewhere else'}? Please confirm the city and PIN.`);
  }
  if (a.state && !/karnataka/i.test(a.state)) add('contradiction', 'state', `State "${a.state}" doesn't match ${a.city || 'the city'} (Karnataka).`, 'Please confirm the state.');

  if (a.investment === null) add('missing', 'investment', a.investmentRaw ? `Investment "${a.investmentRaw}" isn't a number.` : 'Investment capacity is blank.', 'How much can you invest, in ₹ lakh, and where will the money come from?');
  else range('investment', 'Investment', ' lakh');

  if (a.experience === null) add('missing', 'experience', 'Retail experience is blank.', 'How many years have you run or managed a shop? (0 if none)');
  else range('experience', 'Retail experience', ' years');

  if (!a.business) add('missing', 'business', 'Current / past business is blank.', 'What business do you run now, or have you run before?');

  if (a.space === undefined) add('contradiction', 'space', `Space available "${a.spaceRaw}" isn't Owned, Rented or Not yet identified.`, 'Do you own, rent, or not yet have a space?');
  else if (a.space === null) add('missing', 'space', 'Space available is blank.', 'Do you own, rent, or not yet have a space?');
  else if (a.space === 'Not yet identified') {
    if (a.size !== null && a.size > 0) add('contradiction', 'size', `Says no space yet, but gives a size of ${a.sizeRaw || a.size} sq ft.`, 'Do you have a space already? If yes, is it owned or rented?');
    else if (a.floor && a.floor !== 'Not known') add('contradiction', 'floor', `Says no space yet, but gives the floor as ${a.floor}.`, 'Do you have a space already? If yes, is it owned or rented?');
  } else {
    if (a.size === null) add('missing', 'size', `Space is ${a.space.toLowerCase()}, but its size is blank.`, 'How big is the space, in sq ft?');
    else range('size', 'Space size', ' sq ft');
    if (a.floor === undefined) add('contradiction', 'floor', `Floor "${a.floorRaw}" isn't Ground, Upper, Mall unit or Not known.`, 'Which floor is the space on?');
  }

  if (a.launch === null) add('missing', 'launch', 'Target launch is blank.', 'In how many months do you want to open?');
  else if (a.launch < 0) add('contradiction', 'launch', `Target launch of ${a.launchRaw} months isn't possible.`, 'In how many months do you want to open?');
  else range('launch', 'Target launch', ' months');

  const facts = readNotes(a);
  for (const c of facts.contradictions) add('contradiction', c.field, c.text, c.question);

  const info = [...facts.notes];
  if (!a.name) info.push('Applicant name is blank; ask for it before any contact (it does not affect the decision).');
  if (a.launch === 0) info.push('Target launch of 0 months is read as "as soon as possible"; the realistic timeline is in the plan.');
  if (typeof a.investmentRaw === 'string' && a.investment !== null && a.investmentRaw && !/^\d+(\.\d+)?$/.test(a.investmentRaw)) info.push(`Read investment "${a.investmentRaw}" as ${fmtL(a.investment)}.`);
  return { issues, info, review: facts.review, warnApplicant: facts.warnApplicant };
}

// ---------- scoring ----------

export function score(a, territory) {
  const min = CONFIG.tierMinLakh[CITIES[a.city].tier];
  const parts = [];
  const add = (factor, points, max, why) => parts.push({ factor, points: Math.round(points * 100) / 100, max, why });
  add('Investment', 25 * Math.min(1, a.investment / (2 * min)), 25, `${fmtL(a.investment)} vs ${fmtL(min)} minimum; full marks at 2× the minimum`);
  add('Space', { Owned: 15, Rented: 15 }[a.space] || 0, 15, a.space === 'Not yet identified' ? 'No space yet' : `${a.space} (owned and rented score the same)`);
  add('Floor', { Ground: 10, 'Mall unit': 8, Upper: 3 }[a.floor] || 0, 10, a.space === 'Not yet identified' ? 'No space yet' : a.floor || 'Not known');
  const [lo, hi] = CONFIG.idealSqft;
  const sz = a.size || 0;
  add('Size', sz >= lo && sz <= hi ? 5 : (sz >= CONFIG.siteMinSqft && sz <= 1000 ? 3 : 0), 5, sz ? `${sz} sq ft (ideal ${lo}–${hi})` : 'No space yet');
  add('Experience', 15 * Math.min(a.experience, 5) / 5, 15, `${pl(a.experience, 'year')} (full marks at 5)`);
  const biz = a.business.toLowerCase();
  add('Relevant business', RETAIL_WORDS.test(biz) ? 5 : (biz && !/^(none|nil|na|n\/a|-)$/.test(biz) && !/^no /.test(biz) ? 2 : 0), 5, a.business || 'None given');
  const m = a.launch;
  add('Launch realism', m >= 3 && m <= 6 ? 10 : (m === 2 || (m >= 7 && m <= 9)) ? 6 : (m >= 10 && m <= 12) ? 4 : 2, 10, `${pl(m, 'month')} (3–6 is realistic)`);
  add('Territory priority', { High: 10, Medium: 6, Low: 3 }[territory.priority], 10, `${territory.id} is ${territory.priority} priority`);
  const fields = [a.name, a.business, a.language, a.notes];
  add('Completeness', 5 * fields.filter(Boolean).length / fields.length, 5, `${fields.filter(Boolean).length} of ${fields.length} optional fields filled`);
  return { total: Math.round(parts.reduce((s, p) => s + p.points, 0) * 100) / 100, parts };
}

// ---------- deciding ----------

const dupKey = a => a.name ? [norm(a.name), a.pin, a.investment, norm(a.business), a.space, a.size].join('|') : null;

// held: { appId: { since: ISO date } } for Conditional slots promised in an earlier run; they keep their slot for CONFIG.holdDays.
export function decide({ apps, territories, stores }, { held = {}, now = new Date() } = {}) {
  const storeByPin = Object.fromEntries(stores.map(s => [s.pin, s]));
  const prioRank = { High: 0, Medium: 1, Low: 2 };
  const terrSorted = [...territories].sort((x, y) => prioRank[x.priority] - prioRank[y.priority] || byId(x.id, y.id));
  const terrByPin = {}, alsoIn = {};
  for (const t of terrSorted) for (const p of t.pins) { if (!terrByPin[p]) terrByPin[p] = t; else (alsoIn[p] ||= []).push(t.id); }

  const out = {};
  const candidates = {}; // territory id -> decisions competing for it
  const firstByKey = {};
  const sortedApps = [...apps].sort((x, y) => byId(x.id, y.id));
  // A withdrawn original still marks its copies as duplicates, so a copy can't quietly take its place.
  for (const a of sortedApps) { const k = dupKey(a); if (k && !(k in firstByKey)) firstByKey[k] = a.id; }

  for (const a of sortedApps) {
    const v = validate(a);
    const d = out[a.id] = { id: a.id, app: a, checks: [], info: v.info, review: v.review, warnApplicant: v.warnApplicant, issues: v.issues, questions: [], alternatives: [], levers: [] };
    const check = (name, pass, detail) => d.checks.push({ name, pass, detail });

    if (a.withdrawn) {
      d.status = STATUS.WITHDRAWN; d.headline = 'The applicant has withdrawn this application.'; d.reason = 'withdrawn';
      continue;
    }
    const dupOf = firstByKey[dupKey(a)];
    if (dupOf && dupOf !== a.id && !a.confirmed.includes('duplicate')) {
      v.issues.unshift({ kind: 'contradiction', field: 'duplicate', text: `Looks like a duplicate of ${dupOf}: same name, PIN, investment, business and space.`, question: `Is this the same application as ${dupOf}? If so, it will be withdrawn so it doesn't take a second place.` });
      d.duplicateOf = dupOf;
    }
    if (v.issues.length) {
      check('Data complete and consistent', false, v.issues.map(i => i.text).join(' '));
      d.status = STATUS.HOLD;
      d.questions = [...new Set(v.issues.map(i => i.question))];
      d.headline = v.issues[0].text + (v.issues.length > 1 ? ` (+${pl(v.issues.length - 1, 'more issue')})` : '');
      continue;
    }
    check('Data complete and consistent', true, 'All required fields present and plausible; city, PIN, space and notes agree.');

    const tier = CITIES[a.city].tier, min = CONFIG.tierMinLakh[tier];
    if (a.investment < min) {
      check('Investment meets city-tier minimum', false, `${fmtL(a.investment)} is below the Tier ${tier} minimum of ${fmtL(min)}.`);
      d.status = STATUS.REJECTED;
      d.gap = min - a.investment;
      d.headline = `Investment of ${fmtL(a.investment)} is ${fmtL(d.gap)} short of the ${fmtL(min)} minimum for Tier ${tier} ${a.city}.`;
      continue;
    }
    check('Investment meets city-tier minimum', true, `${fmtL(a.investment)} vs ${fmtL(min)} Tier ${tier} minimum (inclusive; as stated by the applicant, not yet verified).`);

    const t = terrByPin[a.pin];
    if (!t) {
      check('PIN is inside a territory', false, `PIN ${a.pin} is not in any territory the brand is opening.`);
      d.status = STATUS.WAITLIST;
      d.headline = `PIN ${a.pin} is not in any territory the brand is currently opening.`;
      d.reason = 'no-territory';
      continue;
    }
    check('PIN is inside a territory', true, `PIN ${a.pin} is in ${t.id} (${t.city}, ${t.priority} priority, ${pl(t.slots, 'open slot')}).${alsoIn[a.pin] ? ` It is also listed in ${alsoIn[a.pin].join(', ')}; it counts for ${t.id} because that territory has higher priority (then lower ID).` : ''}`);
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

    if (a.launch > CONFIG.launchMaxMonths) {
      check(`Launch within ${CONFIG.launchMaxMonths} months`, false, `Target launch is ${pl(a.launch, 'month')} away; slots aren't held that long.`);
      d.status = STATUS.WAITLIST; d.reason = 'launch-horizon';
      d.headline = `Wants to open in ${pl(a.launch, 'month')}; slots are only allocated for launches within ${CONFIG.launchMaxMonths} months.`;
      continue;
    }
    check(`Launch within ${CONFIG.launchMaxMonths} months`, true, a.launch === 0 ? 'Wants to open as soon as possible.' : `Wants to open in ${pl(a.launch, 'month')}.`);

    d.score = score(a, t);
    (candidates[t.id] ||= []).push(d);
  }

  // Allocation: territories in priority order; within each, held Conditional slots first, then score desc then ID. Independent of row order.
  const terrState = {};
  const holdUntil = id => { const s = new Date(held[id].since); s.setDate(s.getDate() + CONFIG.holdDays); return s; };
  for (const t of terrSorted) {
    const list = (candidates[t.id] || []).sort((x, y) => y.score.total - x.score.total || byId(x.id, y.id));
    list.forEach((d, i) => { d.rank = i + 1; d.rankOf = list.length; });
    const taken = {}; // pin -> app id
    const winners = [];
    const holders = list.filter(d => held[d.id] && holdUntil(d.id) > now);
    const order = [...holders.slice(0, t.slots), ...list.filter(d => !holders.slice(0, t.slots).includes(d))];
    for (const d of order) {
      const isHolder = holders.includes(d) && winners.length < t.slots;
      if (taken[d.app.pin]) {
        d.status = STATUS.WAITLIST; d.reason = 'pin-applicant'; d.pinTakenBy = taken[d.app.pin];
        d.checks.push({ name: 'Wins a slot in the territory', pass: false, detail: `PIN ${d.app.pin} went to ${taken[d.app.pin]}, who ranks higher (one store per PIN).` });
        d.headline = `PIN ${d.app.pin} went to ${taken[d.app.pin]}, who ranks higher; only one store per PIN.`;
      } else if (winners.length >= t.slots) {
        const heldBy = winners.filter(w => w.heldSince && w.rank > d.rank);
        d.status = STATUS.WAITLIST; d.reason = t.slots === 0 ? 'no-slots' : heldBy.length ? 'held' : 'slots-full';
        d.checks.push({ name: 'Wins a slot in the territory', pass: false, detail: t.slots === 0 ? `${t.id} has no open slots.` : heldBy.length ? `Ranks above ${heldBy.map(w => w.id).join(', ')}, but ${heldBy.length === 1 ? 'that slot is' : 'those slots are'} held for a Conditional applicant until ${holdUntil(heldBy[0].id).toDateString()}; next in line if it is released.` : `${t.id}'s ${pl(t.slots, 'slot')} went to higher-ranked applicants (${winners.map(w => w.id).join(', ')}).` });
        d.headline = t.slots === 0 ? `${t.id} has no open slots right now.` : heldBy.length ? `Next in line in ${t.id}: the remaining slot is held for ${heldBy[0].id} (Conditional) until ${holdUntil(heldBy[0].id).toDateString()}.` : `Ranked ${d.rank} of ${list.length} in ${t.id}, which has ${pl(t.slots, 'slot')}.`;
      } else {
        taken[d.app.pin] = d.id; winners.push(d);
        if (isHolder) d.heldSince = held[d.id].since;
        d.checks.push({ name: 'Wins a slot in the territory', pass: true, detail: `${isHolder ? `Keeps the slot held since ${new Date(d.heldSince).toDateString()} (Conditional holds last ${CONFIG.holdDays} days). ` : ''}Ranked ${d.rank} of ${list.length} in ${t.id} (score ${d.score.total}/100); slot ${winners.length} of ${t.slots}.` });
      }
    }
    terrState[t.id] = { territory: t, winners: winners.map(w => w.id), candidates: list.map(d => d.id), taken, overlaps: Object.keys(alsoIn).filter(p => t.pins.includes(p)) };
  }

  // Proximity: winners next to an existing store or another winner go to brand review.
  // shortcut: "next to" = same city and PIN numbers 1 apart, because PIN coordinates aren't loaded; replace with a 2 km centroid distance once the PIN directory is bundled.
  const winnersAll = Object.values(out).filter(d => terrState[d.territory]?.winners.includes(d.id)).sort((x, y) => x.rank - y.rank || byId(x.id, y.id));
  const near = (p, q) => p.slice(0, 3) === q.slice(0, 3) && Math.abs(+p - +q) <= 1;
  for (const d of winnersAll) {
    const s = stores.find(s => near(s.pin, d.app.pin));
    if (s) d.review.push({ kind: 'proximity', text: `Existing store ${s.id} is in the neighbouring PIN ${s.pin}; this may take its customers. Distance not measured (PIN coordinates not loaded); the brand should check.` });
    const w = winnersAll.find(o => o !== d && near(o.app.pin, d.app.pin) && (o.territory === d.territory ? o.rank < d.rank : byId(o.id, d.id) < 0));
    if (w) d.review.push({ kind: 'proximity', text: `Another selected applicant, ${w.id}, is in the neighbouring PIN ${w.app.pin}; the two stores may compete. The brand should check.` });
  }

  for (const d of winnersAll) {
    const a = d.app, gaps = siteGaps(a), t = terrState[d.territory].territory;
    d.siteGaps = gaps;
    d.checks.push({ name: 'Site ready', pass: !gaps.length, detail: gaps.length ? gaps.join(' ') : `${a.space} ${a.size} sq ft, ${a.floor.toLowerCase()} floor.` });
    if (d.review.length) {
      d.checks.push({ name: 'No flags for brand review', pass: false, detail: d.review.map(r => r.text).join(' ') });
      d.status = STATUS.REVIEW;
      d.headline = `Wins a slot in ${t.id} (rank ${d.rank}), but needs brand review: ${d.review[0].text}`;
    } else if (gaps.length) {
      d.status = STATUS.CONDITIONAL;
      d.headline = `Wins a slot in ${t.id} (rank ${d.rank}), but the site isn't ready: ${gaps[0].charAt(0).toLowerCase() + gaps[0].slice(1)}`;
    } else {
      d.status = STATUS.APPROVED;
      d.headline = `Wins a slot in ${t.id} (rank ${d.rank} of ${d.rankOf}, score ${d.score.total}) with a ready site in PIN ${a.pin}.`;
    }
  }

  // Alternatives and levers need the final allocation.
  const allocated = new Set(Object.values(terrState).flatMap(s => Object.keys(s.taken)));
  const freePins = t => t.pins.filter(p => !storeByPin[p] && !allocated.has(p) && terrByPin[p] === t);
  const openSlots = t => t.slots - terrState[t.id].winners.length;
  const altText = x => `${x.id} (${x.city}) has ${pl(openSlots(x), 'open slot')}; unused PINs: ${freePins(x).join(', ')}.`;
  for (const d of Object.values(out)) {
    const a = d.app;
    if (d.status === STATUS.REJECTED) {
      const min = CONFIG.tierMinLakh[CITIES[a.city].tier];
      d.levers.push(`Show at least ${fmtL(min)} available (${fmtL(d.gap)} more), for example with a sanctioned loan verified by our lender partner.`);
      const fits = territories.filter(x => CITIES[x.city] && CONFIG.tierMinLakh[CITIES[x.city].tier] <= a.investment && x.slots > 0);
      if (fits.length) d.levers.push(`Or apply in a city where the minimum fits your budget and the brand is opening stores: ${[...new Set(fits.map(x => x.city))].join(', ')}.`);
      continue;
    }
    if (d.status !== STATUS.WAITLIST) continue;
    const t = territories.find(x => x.id === d.territory);
    const sameCity = territories.filter(x => x.city === a.city && openSlots(x) > 0 && freePins(x).length);
    if (['no-territory', 'pin-store', 'pin-applicant'].includes(d.reason)) {
      for (const x of sameCity) d.alternatives.push(altText(x));
      if (d.reason === 'pin-applicant' && t && openSlots(t) <= 0) {
        const last = terrState[t.id].winners.map(id => out[id]).at(-1);
        if (last && d.score.total > last.score.total && freePins(t).length)
          d.levers.push(`With a site in an unused PIN in ${t.id} (${freePins(t).join(', ')}), your score of ${d.score.total} would beat ${last.id} (${last.score.total}) for a slot.`);
      }
    }
    if (d.reason === 'launch-horizon') d.levers.push(`Re-apply when the launch is within ${CONFIG.launchMaxMonths} months, or bring the launch date forward.`);
    if (d.reason === 'slots-full' && t) {
      const last = terrState[t.id].winners.map(id => out[id]).at(-1);
      if (last) {
        const need = last.score.total - d.score.total;
        d.levers.push(`Needs ${+need.toFixed(2)} more points to pass ${last.id} (score ${last.score.total}), the lowest-ranked slot winner in ${t.id}.`);
        for (const l of improvements(a, t)) if (l.gain > need) d.levers.push(`${l.text} (+${+l.gain.toFixed(2)} points) would be enough.`);
      }
      for (const x of sameCity.filter(x => x.id !== t.id)) d.alternatives.push(altText(x));
    }
    if (!d.alternatives.length && !d.levers.length) d.levers.push('Stays on the waitlist and is offered the next slot that opens in this city.');
  }

  for (const d of Object.values(out)) d.plan = plan(d, stores);
  return { decisions: out, territories: terrState, stores, generatedFor: apps.length };
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
  if (a.floor !== 'Ground') opts.push(tryWith({ floor: 'Ground', space: a.space === 'Not yet identified' ? 'Rented' : a.space, size: a.size || CONFIG.idealSqft[0] }, a.space === 'Not yet identified' ? 'Finding a ground-floor space' : 'Moving to a ground-floor space'));
  const min2 = 2 * CONFIG.tierMinLakh[CITIES[a.city].tier];
  if (a.investment < min2) opts.push(tryWith({ investment: min2 }, `Raising investment to ${fmtL(min2)}`));
  return opts.filter(o => o.gain > 0).sort((x, y) => y.gain - x.gain);
}

// ---------- onboarding and applicant messages ----------

const WEEK = { agreement: [1, 2], licences: [2, 6], fitout: [4, 9], training: [7, 10], open: 11 };

function buddyStore(a, stores) {
  const city = stores.some(s => s.city === a.city) ? a.city : BUDDY_CITY[a.city];
  const inCity = stores.filter(s => s.city === city);
  if (!inCity.length) return null;
  // shortcut: nearest by PIN number within the city, not by road distance; use PIN centroids once loaded.
  return inCity.reduce((best, s) => Math.abs(+s.pin - +a.pin) < Math.abs(+best.pin - +a.pin) ? s : best);
}

// What the applicant is told. Never names other applicants or shows their scores.
function applicantText(d) {
  const a = d.app;
  switch (d.reason) {
    case 'no-territory': return `PIN ${a.pin} isn't in an area the brand is opening right now.`;
    case 'pin-store': return `There is already one of our stores in PIN ${a.pin}, and the brand opens only one store per PIN.`;
    case 'pin-applicant': return `Another applicant ranked higher for PIN ${a.pin}, and the brand opens only one store per PIN.`;
    case 'no-slots': return 'The brand isn\'t opening new stores in this area right now; this isn\'t about your application.';
    case 'held': return 'The remaining slot in this area is reserved for another applicant for a limited time. You are next in line if it is released.';
    case 'launch-horizon': return `You'd like to open in ${pl(a.launch, 'month')}; we allocate places only for launches within ${CONFIG.launchMaxMonths} months.`;
    default: return 'All places in this area went to applicants who ranked higher on investment, site and experience.';
  }
}
const applicantLevers = d => [...d.alternatives.map(t => t.replace(/^(TER-\S+) \(([^)]+)\) has \d+ open slots?; unused PINs: /, 'Open areas in $2: PIN ')),
  ...(d.reason === 'slots-full' ? improvements(d.app, { priority: 'Low', id: '' }).map(l => `${l.text} would strengthen your application.`) : []),
  ...(d.reason === 'launch-horizon' ? d.levers : [])];

export function plan(d, stores) {
  const a = d.app;
  const lang = a.language || 'English';
  const warn = d.warnApplicant.join(' ');
  if (d.status === STATUS.WITHDRAWN) return { steps: [], message: msg(a, 'We have recorded that you withdrew your application. Thank you for your interest.') };
  if (d.status === STATUS.HOLD) return { steps: d.questions.map(q => ({ text: q, owner: 'Applicant', state: 'Outstanding' })), message: msg(a, `We need a few answers before we can assess your application:\n${d.questions.map(q => `• ${q}`).join('\n')}${warn ? `\n\n${warn}` : ''}`) };
  if (d.status === STATUS.REJECTED) return { steps: d.levers.map(t => ({ text: t, owner: 'Applicant', state: 'Suggested' })), message: msg(a, `Thank you for applying. ${d.headline} ${d.levers.join(' ')}${warn ? ` ${warn}` : ''}`) };
  if (d.status === STATUS.WAITLIST) {
    const lv = applicantLevers(d);
    return { steps: [...d.alternatives, ...d.levers].map(t => ({ text: t, owner: 'Applicant', state: 'Suggested' })), message: msg(a, `You're on our waitlist. ${applicantText(d)}${lv.length ? `\n\nWhat could help:\n${lv.map(l => `• ${l}`).join('\n')}` : ''}${warn ? `\n\n${warn}` : ''}`) };
  }

  const conditional = d.siteGaps.length > 0;
  const shift = conditional ? 4 : 0; // site search comes first
  const w = ([s, e]) => `Weeks ${s + shift}–${e + shift}`;
  const exp = a.experience;
  const track = exp === 0 ? ['Foundation track', 3, 'retail basics, billing and stock, customer service, brand standards']
    : exp <= 3 ? ['Standard track', 2, 'brand systems, stock and merchandising, staff management']
    : ['Fast track', 1, 'brand systems and standards'];
  const buddy = buddyStore(a, stores);
  const until = d.heldSince ? new Date(new Date(d.heldSince).getTime() + CONFIG.holdDays * 864e5).toDateString() : null;
  const steps = [{ text: 'Screening passed and slot allocated', owner: 'Platform', state: 'Completed' }];
  for (const r of d.review) steps.push({ text: `Brand review: ${r.text}`, owner: 'Brand', state: 'Needs brand approval' });
  steps.push({ text: 'Brand reviews and signs off on this partner', owner: 'Brand', state: 'Needs brand approval' });
  if (conditional) steps.push({ text: `Find a site within ${CONFIG.holdDays} days${until ? ` (slot held until ${until})` : ' (slot held)'}: ${d.siteGaps.join(' ')}`, owner: 'Applicant', state: 'Outstanding', when: 'Weeks 1–4' });
  steps.push(
    { text: 'Verify identity through DigiLocker (via licensed vendor), with consent', owner: 'Applicant', state: 'Outstanding', when: `Week ${1 + shift}` },
    { text: `Verify funds of at least ${fmtL(CONFIG.tierMinLakh[CITIES[a.city].tier])} through the lender partner (attestation only; no bank statements shared with the brand)`, owner: 'Applicant', state: 'Outstanding', when: `Week ${1 + shift}` },
    { text: 'Submit lease or ownership document; brand approves the site', owner: 'Applicant → Brand', state: 'Needs brand approval', when: `Week ${1 + shift}` },
    { text: `Franchise agreement shared; ${CONFIG.reviewDays}-day review before signing or paying anything`, owner: 'Brand → Applicant', state: 'Outstanding', when: w(WEEK.agreement) },
    { text: `Licences: Karnataka Shops & Commercial Establishments registration, trade licence from the ${a.city} city corporation, GST registration, signage permission`, owner: 'Applicant', state: 'Outstanding', when: w(WEEK.licences) },
    { text: 'Store fit-out to brand layout and signage', owner: 'Applicant + Brand projects team', state: 'Outstanding', when: w(WEEK.fitout) },
    { text: `${track[0]} training in ${lang}: ${pl(track[1], 'week')} (${track[2]})`, owner: 'Brand training team', state: 'Suggested', when: w(WEEK.training) },
    { text: buddy ? `Buddy store: ${buddy.id} (${buddy.city}, PIN ${buddy.pin}); shadow shifts there before opening` : 'Buddy store: none nearby; assign a remote mentor', owner: 'Brand', state: 'Suggested', when: w(WEEK.training) },
    { text: 'Check-ins at day 7, 30, 60 and 90 after opening (sales, stock, staffing, customer feedback)', owner: 'Brand area manager', state: 'Suggested', when: `From week ${WEEK.open + shift}` },
  );
  const weeks = WEEK.open + shift;
  const notes = [];
  if (a.launch * 4.3 < weeks) notes.push(a.launch === 0
    ? `Wants to open immediately; realistically the earliest opening is about ${weeks} weeks away (agreement review, licences, fit-out and training).`
    : `Target launch of ${pl(a.launch, 'month')} is tighter than this ~${weeks}-week plan; agree a realistic date.`);
  let body;
  if (d.status === STATUS.APPROVED) body = `Good news: your application for PIN ${a.pin} has passed screening and a place is reserved for you, subject to the brand's final approval and verification. Next: verify your identity and funds, then you'll receive the franchise agreement with ${CONFIG.reviewDays} days to review it before signing or paying anything. Training will be in ${lang}.`;
  else if (d.status === STATUS.CONDITIONAL) body = `Your application for PIN ${a.pin} has passed screening and we're holding a place for you for ${CONFIG.holdDays} days${until ? ` (until ${until})` : ''} while you find a suitable site: ${d.siteGaps.join(' ')}`;
  else body = `Your application for PIN ${a.pin} has passed screening. The brand is reviewing a few points before confirming next steps; we'll be in touch.`;
  return { steps, notes, weeks, track, buddy, message: msg(a, body + (warn ? `\n\n${warn}` : '')) };
}

const msg = (a, body) => `Dear ${a.name || 'applicant'},\n\n${body}\n\n${FRAUD_NOTICE}`;

// ---------- follow-ups ----------

export const FIELD_LABEL = { investment: 'Investment (₹ lakh)', experience: 'Retail experience (years)', space: 'Space available', size: 'Space size (sq ft)', floor: 'Floor', launch: 'Target launch (months)', pin: 'PIN code', city: 'City', language: 'Preferred language', business: 'Current / past business', withdrawn: 'Withdrawn', confirmed: 'Confirmed as correct', slots: 'Open slots', notes: 'Notes' };

function findApp(q, apps) {
  const m = q.match(/\b(?:app(?:lication)?)[\s#-]*0*(\d+)\b/i);
  if (m) {
    const n = Number(m[1]);
    const hits = apps.filter(a => idNum(a.id) === n);
    return hits.length ? { app: hits[0] } : { unknown: `APP-${String(n).padStart(3, '0')}` };
  }
  const words = q.toLowerCase().replace(/'s\b/g, '').split(/[^a-z]+/).filter(w => w.length > 2);
  const full = apps.filter(a => a.name && q.toLowerCase().includes(a.name.toLowerCase()));
  if (full.length === 1) return { app: full[0] };
  const first = apps.filter(a => a.name && words.includes(a.name.toLowerCase().split(/\s+/)[0]));
  if (first.length === 1) return { app: first[0] };
  if (first.length > 1) return { ambiguous: first.map(a => `${a.id} (${a.name})`) };
  return { missing: true };
}

const ASK = /\b(why|what|how|who|which|explain|status|is it|is that|can|could|should|does|did|tell me)\b|\?/i;
const STATUS_WORDS = [[STATUS.HOLD, /on hold|waiting|more information|missing|incomplete/], [STATUS.APPROVED, /approved/], [STATUS.CONDITIONAL, /conditional/], [STATUS.WAITLIST, /waitlist/], [STATUS.REJECTED, /not eligible|rejected|ineligible/], [STATUS.REVIEW, /brand review|flagged|review/]];

export function interpret(input, apps, result, territories = Object.values(result.territories).map(s => s.territory)) {
  const q = input.trim();
  const lower = q.toLowerCase();
  const D = result.decisions;

  if (/^\s*undo\b|undo (the )?last|revert (the )?last/.test(lower)) return { type: 'undo' };
  if (/what (has )?changed|change history|since (the file was )?upload|history of changes/.test(lower)) return { type: 'history' };
  if (/\b(prefer|preference|priorit\w*|favou?r|only|exclude|reject|rank)\b[^.]*\b(kannada|hindi|english|speak\w*|language|gender|wom[ae]n|\bm[ae]n\b|female|male|age|young|old|religion|caste|muslim|hindu|christian)\b/.test(lower))
    return { type: 'answer', text: 'I can\'t do that. Name, gender, age, religion, caste and language never affect eligibility or scores. Preferred language is used only for training and messages, so every applicant is judged on the same facts.' };
  if (/payback|\bearn|\bprofit|\bincome|\brevenue|\broi\b|return on|how much (will|can|would) .* make/.test(lower))
    return { type: 'answer', text: 'I don\'t estimate payback or earnings, and applicants are never promised any. Any payback estimate is the brand\'s own internal figure, with its assumptions written down. I can explain an applicant\'s decision, ranking, or onboarding plan instead.' };

  const hasAppId = /\bapp(?:lication)?[\s#-]*\d/i.test(q);
  const terr = q.match(/\bter[\s-]*0*(\d+)\b/i);
  if (terr && !hasAppId) {
    const t = territories.find(x => idNum(x.id) === Number(terr[1]));
    if (!t) return { type: 'clarify', text: `There's no territory TER-${terr[1].padStart(2, '0')} in this file.` };
    const slots = lower.match(/(\d+)\s*(open\s*)?slots?/);
    if (slots && !ASK.test(lower.replace(/now has/, ''))) return { type: 'proposal', kind: 'territory', target: t.id, changes: [{ field: 'slots', from: t.slots, to: Number(slots[1]) }], assumptions: [], warnings: [] };
    const s = result.territories[t.id];
    return { type: 'answer', text: territoryText(s, D) };
  }

  const pinQ = q.match(/\b(\d{6})\b/);
  if (pinQ && !hasAppId && /who|won|rank|compet|went|get|got|applicants?/.test(lower)) return { type: 'answer', text: pinText(pinQ[1], D, result) };

  if (!hasAppId && /\b(which|list|show|all)\b/.test(lower) && STATUS_WORDS.some(([, rx]) => rx.test(lower))) {
    const city = Object.keys(CITIES).find(c => lower.includes(c.toLowerCase()) || Object.entries(CITY_ALIASES).some(([al, cc]) => cc === c && lower.includes(al)));
    const status = STATUS_WORDS.find(([, rx]) => rx.test(lower))[0];
    const hits = Object.values(D).filter(d => d.status === status && (!city || d.app.city === city || d.app.cityRaw.toLowerCase() === city.toLowerCase())).sort((x, y) => byId(x.id, y.id));
    if (!hits.length) return { type: 'answer', text: `No ${city ? `${city} ` : ''}applicants are ${status}.` };
    return { type: 'answer', text: `${hits.length} ${city ? `${city} ` : ''}${hits.length === 1 ? 'applicant is' : 'applicants are'} ${status}:\n${hits.map(d => `• ${d.id}${d.app.name ? ` (${d.app.name})` : ''}: ${d.questions.length ? d.questions.join(' ') : d.headline}`).join('\n')}`, ids: hits.map(d => d.id) };
  }

  const f = findApp(q, apps);
  if (f.missing) return { type: 'clarify', text: 'Which application do you mean? Please include its ID, like APP-007, or the applicant\'s full name.' };
  if (f.unknown) return { type: 'clarify', text: `There's no ${f.unknown} in this file, so nothing was changed. Check the ID and try again.` };
  if (f.ambiguous) return { type: 'clarify', text: `More than one applicant matches: ${f.ambiguous.join(', ')}. Which one?` };
  const a = f.app, d = D[a.id];

  if (/approve .*(anyway|regardless)|\boverride\b|force (approve|through)|i'?m the (brand|owner)/.test(lower))
    return { type: 'answer', text: `${why(d)}\n\nI can't override this. Decisions follow the brand's rules so every applicant is treated the same way. The brand can still approve an exception outside this tool; if the rules should change (for example a threshold), change them for everyone and re-run.`, id: a.id };
  if (/withdr[ae]w|pulled out|no longer interested|dropped out|backed out|cancel(l)?ed (their|the) application/.test(lower))
    return { type: 'proposal', kind: 'app', target: a.id, changes: [{ field: 'withdrawn', from: false, to: true }], assumptions: [], warnings: d && isWinner(d) ? [`${a.id} currently holds a slot in ${d.territory}; it will pass to the next eligible applicant.`] : [] };

  const questionStart = /^\s*(why|what|how|who|which|explain|is|are|does|did|can|could|should|tell)\b/.test(lower);
  const updateCue = /\b(now|found|got|secured|moved|changed|increased|raised|actually|instead|correction|update|owns|bought|rented|leased|ignore)\b|\bnot ₹?\d|hasn'?t found|has \d+ years/.test(lower);
  if (updateCue && !questionStart) {
    const r = parseChanges(lower, a, result);
    if (r.clarify) return { type: 'clarify', text: r.clarify };
    if (r.changes.length) return { type: 'proposal', kind: 'app', target: a.id, changes: r.changes, assumptions: r.assumptions, warnings: r.warnings };
  }
  if (!ASK.test(lower)) {
    return { type: 'clarify', text: `I couldn't tell which detail of ${a.id} changed. I can update: ${['investment', 'experience', 'space', 'size', 'floor', 'launch', 'pin', 'language'].map(k => FIELD_LABEL[k]).join(', ')}, or record a withdrawal. For example: "${a.id} now has a 400 sq ft ground-floor space" or "${a.id} can invest 30 lakh".` };
  }

  if (/\b(paid|payment|agent|fee|money|bribe|cash)\b/.test(lower)) {
    const fr = d.review.find(r => r.kind === 'fraud');
    return { type: 'answer', id: a.id, text: fr ? `Yes, this is a problem. ${fr.text}\n\n${a.id} is ${statusWord(d)}. The applicant's message warns them not to pay anyone: ${FRAUD_NOTICE}` : `${a.id}'s application doesn't mention any payment. ${FRAUD_NOTICE}` };
  }
  if (/close|near|distance|cannibal|next to|neighbou?r/.test(lower)) {
    const pr = d.review.filter(r => r.kind === 'proximity');
    const s = wbStoresFrom(result).find(s => s.pin.slice(0, 3) === (a.pin || '').slice(0, 3) && Math.abs(+s.pin - +a.pin) <= 1);
    return { type: 'answer', id: a.id, text: pr.length ? `Possibly. ${pr.map(r => r.text).join(' ')} ${a.id} is ${statusWord(d)}, so a person decides.` : s ? `Existing store ${s.id} is in the neighbouring PIN ${s.pin}. ${a.id} is ${statusWord(d)}.` : `No existing store or selected applicant is in ${a.id}'s PIN (${a.pin}) or a neighbouring one. Distances aren't measured yet because PIN coordinates aren't loaded.` };
  }
  if (/prepar|train|onboard|plan\b|ready to run|run the store/.test(lower)) return { type: 'answer', id: a.id, text: planText(d) };
  if (/open (immediately|now|soon|right away)|launch|timeline|how long|when can|really open/.test(lower)) return { type: 'answer', id: a.id, text: launchText(d) };
  if (/what would|what does .* need|need to|next step|do next|how can|how could|move forward|to progress|what change|improve|get approved/.test(lower)) return { type: 'answer', id: a.id, text: needs(d) };
  return { type: 'answer', id: a.id, text: why(d) };
}

const wbStoresFrom = result => result.stores;
const statusWord = d => d.status === STATUS.WAITLIST ? 'on the waitlist' : d.status === STATUS.REVIEW ? 'waiting for brand review' : d.status;

function territoryText(s, D) {
  const t = s.territory;
  const lose = s.candidates.filter(id => !s.winners.includes(id));
  return `${t.id} (${t.city}, ${t.priority} priority) has ${pl(t.slots, 'slot')}. ${s.winners.length ? `Slots went to:\n${s.winners.map(id => `• ${id}: ${D[id].status}, rank ${D[id].rank}, score ${D[id].score.total}. ${D[id].headline}`).join('\n')}` : 'No slots allocated.'}${lose.length ? `\nNot selected:\n${lose.map(id => `• ${id} (score ${D[id].score.total}): ${D[id].headline}`).join('\n')}` : ''}${s.overlaps.length ? `\nPINs also listed in another territory: ${s.overlaps.join(', ')} (counted here).` : ''}`;
}

function pinText(pin, D, result) {
  const ds = Object.values(D).filter(d => d.app.pin === pin).sort((x, y) => (x.rank ?? 99) - (y.rank ?? 99) || byId(x.id, y.id));
  if (!ds.length) return `No application is for PIN ${pin}.`;
  const winner = ds.find(isWinner);
  const s = ds[0].territory && result.territories[ds[0].territory];
  const free = s ? s.territory.pins.filter(p => p !== pin && !Object.keys(s.taken).includes(p)) : [];
  return `PIN ${pin}: ${winner ? `${winner.id} holds it (${winner.status}, score ${winner.score.total}).` : 'nobody holds it.'} The brand opens only one store per PIN.\n${ds.map(d => `• ${d.id}: ${d.status}${d.score ? `, score ${d.score.total}, rank ${d.rank} in ${d.territory}` : ''}${d.duplicateOf ? `, flagged as a likely duplicate of ${d.duplicateOf}` : ''}. ${d.headline}`).join('\n')}${free.length && s ? `\nOther PINs in ${s.territory.id} that others could use: ${free.join(', ')}.` : ''}`;
}

function planText(d) {
  if (!isWinner(d)) return `${d.id} doesn't have an onboarding plan yet because it is ${statusWord(d)}. ${needs(d)}`;
  const p = d.plan;
  return `${d.id}'s plan (about ${p.weeks} weeks to opening):\n${p.steps.filter(s => s.state !== 'Completed').map(s => `• ${s.text}${s.when ? ` (${s.when})` : ''}`).join('\n')}${p.notes.length ? `\n${p.notes.join(' ')}` : ''}`;
}

function launchText(d) {
  const a = d.app;
  const weeks = d.plan.weeks || WEEK.open;
  const track = d.plan.track || (a.experience === 0 ? ['Foundation track', 3] : null);
  return `${d.id} wants to open ${a.launch === 0 ? 'immediately' : `in ${pl(a.launch, 'month')}`}. Realistically the earliest opening is about ${weeks} weeks after approval: ${CONFIG.reviewDays}-day agreement review, licences (weeks 2–6), fit-out (weeks 4–9) and training (weeks 7–10).${track ? ` With ${pl(a.experience, 'year')} of retail experience, training is the ${track[0]} (${pl(track[1], 'week')}).` : ''} Current status: ${statusWord(d)}. ${d.headline}`;
}

function parseChanges(s, a, result) {
  const c = [], assumptions = [], warnings = [];
  const set = (field, to, note) => { if (to !== undefined && to !== a[field]) { c.push({ field, from: a[field], to }); if (note) assumptions.push(note); } };
  const issueFields = validate(a).issues.map(i => i.field);
  const confirm = field => { if (issueFields.includes(field) && !a.confirmed.includes(field)) c.push({ field: 'confirmed', from: a.confirmed, to: [...a.confirmed, field] }); };

  const noSpace = /(hasn'?t|has not|have not|not yet|yet to|still (hasn'?t|has not|no|looking|searching))\s*(found|got|identified|secured)?\b[^.]*\b(space|shop|site|premises)|\bno space\b/.test(s);
  if (noSpace) {
    set('space', 'Not yet identified');
    set('size', null); set('floor', 'Not known');
    return { changes: c, assumptions, warnings };
  }
  const floor = /ground[\s-]*floor|\bground\b/.test(s) ? 'Ground' : /\bmall\b/.test(s) ? 'Mall unit' : /(upper|first|second|1st|2nd)[\s-]*floor/.test(s) ? 'Upper' : undefined;
  const size = s.match(/(\d[\d,]*)\s*(sq\.?\s*ft|sqft|square\s*feet|sq\.?\s*feet)/);
  const pin = s.match(/\b(\d{6})\b/);
  const foundSpace = /\b(found|got|secured|identified|located|new space|new shop|new site|now has (a|an)|bought|purchased|rented|leased)\b/.test(s) && /space|shop|site|unit|premises|floor|store/.test(s);
  const owns = /\b(bought|purchased|owns|owned)\b/.test(s), rents = /\b(rent|rented|lease|leased)\b/.test(s);
  if (owns) { a.space === 'Owned' ? confirm('space') : set('space', 'Owned'); }
  else if (rents) { a.space === 'Rented' ? confirm('space') : set('space', 'Rented'); }
  else if (foundSpace && a.space === 'Not yet identified') set('space', 'Rented', 'Assumed the new space is rented. Say "owned" if it is owned.');
  if (floor) set('floor', floor);
  if (size) set('size', Number(size[1].replace(/,/g, '')));
  if (pin) set('pin', pin[1]);
  const loan = /\bloan\b/.test(s);
  const money = s.match(/(\d+(\.\d+)?)\s*(lakh|lakhs|lac|l\b|crore|cr\b)/);
  if (money) {
    const amt = Number(money[1]) * (/cr/.test(money[3]) ? 100 : 1);
    if (loan && !/total|now (has|can invest)|can invest/.test(s)) set('investment', (a.investment || 0) + amt, `Added the ₹${amt} lakh loan to the stated ₹${a.investment ?? 0} lakh. It still needs the lender partner's confirmation.`);
    else set('investment', amt);
  } else if (loan) return { clarify: `How much is ${a.id}'s loan, in ₹ lakh, and has the bank sanctioned it? Then I can update the investment.` };
  const exp = s.match(/(\d+)\s*years?/);
  if (exp && /experience|years? (of|in|running|managing)|retail/.test(s)) { Number(exp[1]) === a.experience ? confirm('experience') : set('experience', Number(exp[1])); }
  const launch = s.match(/(\d+)\s*months?/);
  if (launch && /launch|open|months? (from|time)|in \d+ months/.test(s)) set('launch', Number(launch[1]));
  for (const lang of ['Kannada', 'English', 'Hindi']) if (s.includes(lang.toLowerCase()) && /language|train|speak|prefer/.test(s)) set('language', lang);
  const city = Object.keys(CITIES).find(x => s.includes(x.toLowerCase()) || Object.entries(CITY_ALIASES).some(([al, cc]) => cc === x && new RegExp(`\\b${al}\\b`).test(s)));
  if (city && city !== a.city && !pin) return { clarify: `What is the PIN code of ${a.id}'s new location in ${city}? I need it to place the application in a territory.` };
  if (city && pin) set('city', city);
  if (/\b(same|duplicate|withdraw (the )?second|is the same)\b/.test(s) && issueFields.includes('duplicate')) confirm('duplicate');
  if (/\b(confirm|correct|right|is accurate|yes)\b/.test(s)) for (const f of ['investment', 'size', 'experience', 'launch']) if (s.includes(f === 'size' ? 'size' : f)) confirm(f);

  if (foundSpace && !c.some(x => ['size', 'floor', 'pin'].includes(x.field)) && !(a.space === 'Not yet identified' && floor))
    return { clarify: `Good news for ${a.id}. Where is the new space (PIN), how big is it (sq ft), and which floor is it on?` };
  if (c.some(x => x.field === 'space' && x.to !== 'Not yet identified') && a.size === null && !size)
    return { clarify: `How big is ${a.id}'s new space, in sq ft? (and which floor, if not said)` };

  const newPin = c.find(x => x.field === 'pin')?.to;
  if (newPin) {
    const store = wbStoresFrom(result).find(st => st.pin === newPin);
    if (store) warnings.push(`Existing store ${store.id} is already in PIN ${newPin}, so ${a.id} can't open there; it would go to the waitlist.`);
    const holder = Object.values(result.decisions).find(d => d.id !== a.id && isWinner(d) && d.app.pin === newPin);
    if (holder) warnings.push(`${holder.id} already holds PIN ${newPin}; ${a.id} would only get it by outranking them.`);
    if (!city && PIN_CITY[newPin.slice(0, 3)] && PIN_CITY[newPin.slice(0, 3)] !== a.city) assumptions.push(`City will change to ${PIN_CITY[newPin.slice(0, 3)]} to match the PIN.`);
  }
  return { changes: c, assumptions, warnings };
}

export function applyChanges(apps, id, changes) {
  return apps.map(a => {
    if (a.id !== id) return a;
    const b = { ...a, confirmed: [...a.confirmed] };
    for (const { field, to } of changes) {
      b[field] = to;
      if (`${field}Raw` in b) b[`${field}Raw`] = to === null ? '' : String(to);
      if (field === 'space' && to === 'Not yet identified') { b.size = null; b.sizeRaw = ''; b.floor = 'Not known'; b.floorRaw = 'Not known'; }
    }
    if (changes.some(c => c.field === 'pin') && !changes.some(c => c.field === 'city')) {
      const c = PIN_CITY[String(b.pin).slice(0, 3)];
      if (c) { b.city = c; b.cityRaw = c; }
    }
    // A corrected field supersedes what the notes said about it.
    for (const { field } of changes) if (['space', 'pin', 'experience', 'investment', 'size'].includes(field) && !b.confirmed.includes(field)) b.confirmed.push(field);
    return b;
  });
}

export function applyTerritoryChange(territories, id, changes) {
  return territories.map(t => t.id !== id ? t : { ...t, ...Object.fromEntries(changes.map(c => [c.field, c.to])) });
}

// Status changes first, then rank-only changes; nothing else counts as a change.
export function diff(before, after) {
  const rows = [];
  for (const id of Object.keys(after.decisions)) {
    const x = before.decisions[id], y = after.decisions[id];
    if (!x) continue;
    if (x.status !== y.status) rows.push({ id, kind: 'status', from: x.status, to: y.status, why: y.headline });
    else if (isWinner(y) || y.status === STATUS.WAITLIST) {
      if (x.rank && y.rank && x.rank !== y.rank && x.territory === y.territory) rows.push({ id, kind: 'rank', from: `rank ${x.rank}`, to: `rank ${y.rank}`, why: y.headline });
    }
  }
  return rows.sort((p, q) => (p.kind === 'status' ? 0 : 1) - (q.kind === 'status' ? 0 : 1) || byId(p.id, q.id));
}

export function why(d) {
  const failed = d.checks.find(c => c.pass === false);
  const lines = [`${d.id}${d.app.name ? ` (${d.app.name})` : ''} is ${statusWord(d)}. ${d.headline}`];
  if (failed) lines.push(`First check that failed: ${failed.name}. ${failed.detail}`);
  if (d.status === STATUS.HOLD) lines.push(`To move forward, answer:\n${d.questions.map(q => `• ${q}`).join('\n')}`);
  if (d.score) lines.push(`Score ${d.score.total}/100: ${d.score.parts.map(p => `${p.factor} ${p.points}/${p.max}`).join(', ')}.`);
  if (d.review.length && !failed?.name.includes('brand review')) lines.push(`Flags for the brand: ${d.review.map(r => r.text).join(' ')}`);
  if (d.info.length) lines.push(d.info.join(' '));
  return lines.join('\n');
}

export function needs(d) {
  const s = d.status;
  if (s === STATUS.APPROVED) return `${d.id} is moving forward. Remaining steps: brand sign-off, identity and funds verification, then the agreement (${CONFIG.reviewDays}-day review), licences, fit-out and ${d.plan.track ? `${d.plan.track[0]} ` : ''}training.`;
  if (s === STATUS.CONDITIONAL) return `${d.id} holds a slot for ${CONFIG.holdDays} days. To become Approved: ${d.siteGaps.join(' ')}`;
  if (s === STATUS.REVIEW) return `${d.id} holds a slot, but the brand must first clear: ${d.review.map(r => r.text).join(' ')}${d.siteGaps.length ? ` The site also needs: ${d.siteGaps.join(' ')}` : ''}`;
  if (s === STATUS.HOLD) return `${d.id} needs these answered before it can be assessed:\n${d.questions.map(q => `• ${q}`).join('\n')}`;
  if (s === STATUS.WITHDRAWN) return `${d.id} has withdrawn; nothing further is needed.`;
  return `${d.id} (${statusWord(d)}): ${[...d.levers, ...d.alternatives].join(' ') || 'Nothing the applicant can change right now; a slot must open.'}`;
}

// Conditional slots promised in this result, keeping the original start date of any earlier hold.
export function nextHolds(result, held = {}, now = new Date()) {
  const out = {};
  for (const d of Object.values(result.decisions)) if (d.status === STATUS.CONDITIONAL) out[d.id] = held[d.id] || { since: now.toISOString() };
  return out;
}

// Facts for the "Today's summary" panel. Code builds it; the panel only lays it out.
export function summaryFacts(result, history = []) {
  const ds = Object.values(result.decisions).sort((x, y) => byId(x.id, y.id));
  const counts = {};
  for (const d of ds) counts[d.status] = (counts[d.status] || 0) + 1;
  const attention = [];
  for (const d of ds) {
    if (d.status === STATUS.REVIEW) attention.push({ id: d.id, text: d.review.map(r => r.text).join(' ') });
    else if (d.status === STATUS.HOLD) attention.push({ id: d.id, text: d.issues[0]?.text || d.headline });
    else if (d.review.length) attention.push({ id: d.id, text: `${d.status}; flag: ${d.review[0].text}` });
  }
  const slots = Object.values(result.territories).map(s => ({ id: s.territory.id, city: s.territory.city, filled: s.winners.length, total: s.territory.slots, overlaps: s.overlaps }));
  return { total: ds.length, counts, attention, slots, changes: history.filter(h => h.kind === 'change') };
}
