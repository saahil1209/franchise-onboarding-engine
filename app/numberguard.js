// numberGuard (SPEC §8): every number in AI-written text must match a number in the computed inputs the AI was
// given, after normalisation, or be on the task's allowlist. Anything else fails the check.
// Normalisation: thousands separators (Indian and international), ₹, lakh/crore, percent vs fraction, and
// rounding to the precision shown in the text.

const TOKEN = /(₹\s*)?(\d{1,3}(?:,\d{2,3})+|\d+)(\.\d+)?\s*(%|per\s*cent|lakhs?|crores?|cr\b|km\b)?/gi;

export function numbersIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(TOKEN)) {
    // Skip digits that are part of a word or identifier, like "APP-012" or "TER-01" (allowlisted separately).
    const before = m.input[m.index - 1];
    if (before && /[A-Za-z_-]/.test(before) && !m[1]) continue;
    const whole = m[2].replace(/,/g, ''), frac = m[3] || '';
    out.push({ raw: m[0].trim(), value: Number(whole + frac), decimals: frac ? frac.length - 1 : 0, unit: (m[4] || '').toLowerCase().replace(/\s+/g, '') });
  }
  return out;
}

// Every number found anywhere in the inputs (numbers, and numbers inside strings).
export function inputNumbers(input) {
  const out = [];
  const walk = v => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (typeof v === 'string') for (const n of numbersIn(v)) out.push(n.value);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  return out;
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// An input value expressed the ways text might show it: as is, fraction ↔ percent, rupees ↔ lakh or crore.
const forms = a => [a, a * 100, a / 100, a / 1e5, a / 1e7, a * 1e5, a * 1e7];

export function numberGuard(text, input, allowlist = []) {
  const allowed = [...inputNumbers(input), ...allowlist.map(Number).filter(Number.isFinite)];
  const bad = [];
  for (const n of numbersIn(text)) {
    // The number as shown must equal some input value, rounded to the precision shown.
    const ok = allowed.some(a => forms(a).some(f => round(f, n.decimals) === n.value));
    if (!ok) bad.push(n.raw);
  }
  return { ok: bad.length === 0, bad };
}
