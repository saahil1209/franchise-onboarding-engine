// Builds app/data/pins.json (PIN centroids, district, state, post-office mix) from the All India Pincode Directory.
// Source: Department of Posts, All India Pincode Directory (data.gov.in, Government Open Data Licence – India),
// as repackaged in the npm package india-pincode@2.5.9 (data/pincodes.json.gz). See data/SOURCES.md.
//
// Usage: node data/build-pins.mjs <path to pincodes.json.gz>
// Offices with coordinates outside India, far from the rest of their district, or far from the other offices of
// their PIN are dropped before averaging. A PIN with no trusted coordinate gets none (it is never recommended).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const src = process.argv[2];
if (!src) { console.error('Usage: node data/build-pins.mjs <pincodes.json.gz>'); process.exit(1); }
const offices = JSON.parse(gunzipSync(readFileSync(src)).toString('utf8'));

const inIndia = o => typeof o.a === 'number' && typeof o.n === 'number' && o.a >= 6 && o.a <= 37.5 && o.n >= 68 && o.n <= 97.5;
const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const km = (a, b) => {
  const R = 6371, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const title = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bAnd\b/g, 'and').replace(/\bThe\b/g, 'The');

// District check: an office far from the rest of its district has a bad coordinate (e.g. Agram, 560007, placed
// near Mandya). Radius: 3 × the district's median office distance from its centre, at least 30 km.
const byDistrict = new Map();
for (const o of offices) if (inIndia(o)) { const k = `${o.s}|${o.i}`; (byDistrict.get(k) || byDistrict.set(k, []).get(k)).push(o); }
const districtOk = new Map();
for (const [k, os] of byDistrict) {
  const c = [median(os.map(o => o.a)), median(os.map(o => o.n))];
  const ds = os.map(o => km(c, [o.a, o.n])), limit = Math.max(30, 3 * median(ds));
  districtOk.set(k, o => km(c, [o.a, o.n]) <= limit);
}
const trusted = o => inIndia(o) && districtOk.get(`${o.s}|${o.i}`)(o);

const byPin = new Map();
for (const o of offices) { if (!/^\d{6}$/.test(o.p)) continue; (byPin.get(o.p) || byPin.set(o.p, []).get(o.p)).push(o); }

const states = [], stateIx = new Map();
const rows = [];
let dropped = 0, noCoords = 0;
for (const [pin, os] of [...byPin].sort(([a], [b]) => a.localeCompare(b))) {
  const located = os.filter(trusted);
  dropped += os.filter(inIndia).length - located.length;
  // The PIN's district and state: the most common among its offices.
  const mode = k => { const c = new Map(); for (const o of os) c.set(o[k], (c.get(o[k]) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0][0]; };
  const state = title(mode('s')), district = title(mode('i'));
  if (state === 'Na') continue;
  let lat = null, lng = null;
  if (located.length) {
    const mid = [median(located.map(o => o.a)), median(located.map(o => o.n))];
    const near = located.filter(o => km(mid, [o.a, o.n]) <= 25);
    dropped += located.length - near.length;
    const use = near.length ? near : located;
    lat = +(use.reduce((s, o) => s + o.a, 0) / use.length).toFixed(4);
    lng = +(use.reduce((s, o) => s + o.n, 0) / use.length).toFixed(4);
  } else noCoords++;
  if (!stateIx.has(state)) { stateIx.set(state, states.length); states.push(state); }
  const branch = os.filter(o => o.t === 'BO').length;
  // [pin, state index, district, lat, lng, offices, branch offices, head office present]
  rows.push([pin, stateIx.get(state), district, lat, lng, os.length, branch, os.some(o => o.t === 'HO') ? 1 : 0]);
}

mkdirSync(new URL('../app/data/', import.meta.url), { recursive: true });
const out = {
  source: 'All India Pincode Directory, Department of Posts (data.gov.in, Government Open Data Licence – India); via npm india-pincode@2.5.9',
  level: 'PIN', built: new Date().toISOString().slice(0, 10),
  columns: ['pin', 'state', 'district', 'lat', 'lng', 'offices', 'branchOffices', 'headOffice'],
  states, rows,
};
writeFileSync(new URL('../app/data/pins.json', import.meta.url), JSON.stringify(out));
console.log(`${rows.length} PINs, ${states.length} states/UTs; ${noCoords} PINs without coordinates; ${dropped} outlying office coordinates dropped.`);
