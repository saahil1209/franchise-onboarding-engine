// Vercel function: Gemini explains the engine's top picks. Structured output, validated, numberGuard-checked.
// Retries once; anything that still fails is left out, and the page shows the engine's own reason instead.
import { geminiFromEnv } from './_gemini.js';
import { numberGuard } from '../numberguard.js';
import { VERSION, SYSTEM, SCHEMA, userPrompt } from '../prompts/explain-picks.v1.js';

const MAX_PICKS = 10;
const BANNED = /\b(revenue|profit|earn|earnings|payback|income will|guarantee)/i;

// Keep only what the task needs (CLAUDE.md, context budget).
export function trimInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const brand = { name: String(b.brand?.name || '').slice(0, 80), industry: String(b.brand?.industry || '').slice(0, 60), tier: String(b.brand?.tier || '').slice(0, 20) };
  const picks = (Array.isArray(b.picks) ? b.picks : []).slice(0, MAX_PICKS).map(p => ({
    pin: String(p.pin || '').slice(0, 6), rank: Number(p.rank) || null, area: String(p.area || '').slice(0, 80), score: Number(p.score) || 0, confidence: Number(p.confidence) || 0,
    factors: (Array.isArray(p.factors) ? p.factors : []).slice(0, 8).map(f => ({ name: String(f.name || '').slice(0, 40), value: f.value === null ? 'not loaded' : Number(f.value), note: String(f.note || '').slice(0, 200) })),
  })).filter(p => /^\d{6}$/.test(p.pin));
  const missing = (Array.isArray(b.missing) ? b.missing : []).slice(0, 8).map(m => String(m).slice(0, 200));
  return { brand, picks, missing };
}

function validate(raw, input) {
  let out;
  try { out = JSON.parse(raw); } catch { return null; }
  if (!out || !Array.isArray(out.picks) || !Array.isArray(out.suggestions)) return null;
  const known = new Set(input.picks.map(p => p.pin));
  const picks = [], failed = [];
  for (const p of out.picks) {
    if (!known.has(String(p?.pin)) || typeof p.reason !== 'string') continue;
    const g = numberGuard(p.reason, input, input.picks.map(x => x.rank));
    if (g.ok && !BANNED.test(p.reason)) picks.push({ pin: String(p.pin), reason: p.reason.trim() }); else failed.push({ pin: String(p.pin), bad: g.bad });
  }
  const suggestions = out.suggestions.filter(s => typeof s === 'string' && numberGuard(s, input).ok && !BANNED.test(s)).slice(0, 3);
  return { picks, suggestions, failed };
}

export async function explain(body, gemini) {
  const input = trimInput(body);
  if (!input.picks.length) return { status: 400, json: { error: 'No picks to explain.' } };
  if (!gemini.ready) return { status: 503, json: { error: `Gemini is not configured: set ${gemini.missing.join(' and ')} in Vercel.` } };
  let best = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw;
    try { raw = await gemini.generate({ system: SYSTEM, prompt: userPrompt(input), schema: SCHEMA }); } catch { continue; }
    const v = validate(raw, input);
    if (v && (!best || v.picks.length > best.picks.length)) best = v;
    if (v && !v.failed.length && v.picks.length === input.picks.length) break;
  }
  if (!best) return { status: 502, json: { error: 'Gemini did not return a usable answer; showing the engine’s reasons.' } };
  return { status: 200, json: { prompt: VERSION, model: gemini.model, picks: best.picks, suggestions: best.suggestions, rejected: best.failed.length } };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;
  if (JSON.stringify(body || {}).length > 40000) return res.status(413).json({ error: 'Too much input.' });
  const r = await explain(body, geminiFromEnv());
  res.setHeader('Cache-Control', 'no-store');
  res.status(r.status).json(r.json);
}
