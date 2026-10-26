// Gemini adapter behind one function, so tests and local runs use a mock and never call the live service.
// Files starting with "_" in api/ are not routes on Vercel.
import { GoogleGenAI } from '@google/genai';

export function geminiFromEnv(env = process.env) {
  const apiKey = String(env.GEMINI_API_KEY || '').trim();
  // The model ID must be pinned in config (CLAUDE.md, Gemini). No default: an unverified ID could be retired.
  const model = String(env.GEMINI_MODEL_FAST || '').trim();
  if (!apiKey || !model) return { ready: false, missing: [!apiKey && 'GEMINI_API_KEY', !model && 'GEMINI_MODEL_FAST'].filter(Boolean) };
  const ai = new GoogleGenAI({ apiKey });
  return {
    ready: true, model,
    async generate({ system, prompt, schema }) {
      const r = await ai.models.generateContent({
        model, contents: prompt,
        config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.2 },
      });
      return r.text;
    },
  };
}

// A stand-in for tests: returns whatever the test scripts, in order.
export function mockGemini(replies) {
  let i = 0;
  return { ready: true, model: 'mock', calls: [], async generate(req) { this.calls.push(req); const r = replies[Math.min(i++, replies.length - 1)]; if (r instanceof Error) throw r; return typeof r === 'string' ? r : JSON.stringify(r); } };
}
