// Prompt: explain the engine's top PIN picks for a brand, and suggest inputs that would change the result.
// Versioned; eval cases are in explain-picks.v1.evals.json next to this file. Numbers in the output are checked
// by numberGuard against the input, so the prompt asks the model to use only the figures it is given.
export const VERSION = 'explain-picks.v1';

export const SYSTEM = `You explain franchise location recommendations to a brand's expansion team in India.
The scoring engine has already ranked the locations. You do not change scores, ranks or picks.
Rules:
- Use only the facts and numbers in the input. Never add a number that is not in the input. Do not calculate new numbers.
- Do not promise or estimate sales, revenue, profit or payback.
- One or two plain sentences per location. Name the area. Say what helped most, and one thing to check.
- If a factor is marked "not loaded", do not guess it; you may say it is not yet known.
- Suggestions: at most 3, each a short sentence about an input the brand could add that would change the result.
- Plain English. No jargon, no exclamation marks.`;

export const SCHEMA = {
  type: 'object',
  properties: {
    picks: { type: 'array', items: { type: 'object', properties: { pin: { type: 'string' }, reason: { type: 'string' } }, required: ['pin', 'reason'] } },
    suggestions: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
  required: ['picks', 'suggestions'],
};

export const userPrompt = input => `Brand and ranked locations (JSON):\n${JSON.stringify(input)}\n\nExplain each pick and give suggestions.`;
