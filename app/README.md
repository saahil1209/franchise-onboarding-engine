# Franchise Onboarding Engine (Case 1 MVP)

A static web page. The judges upload the Case 1 workbook. Every applicant gets a status, the reason, the checks behind it, a score and next steps or an onboarding plan. Follow-up questions and new facts are typed into the box on the page.

Everything runs in the visitor's browser tab, so:

- there's no login and no server
- each judge's session is isolated
- uploaded data never leaves the browser

## Files

- `engine.js`: all the rules (reading the workbook, validation, gates, score, allocation, onboarding plans, follow-ups). It has no UI.
- `app.js` and `index.html`: the page.
- `sample.js`: a provisional 23-row test workbook built from the brief's column list. Every row plants one edge case. The page has "Try with sample data" and "Download sample .xlsx" buttons.
- `engine.test.js`: the tests. Run them with `node --test`.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. ES modules don't load from `file://`, so you need this server even locally.

## Deploy (a public link with no login)

The folder is static, so any static host works. Two options:

- **Netlify Drop:** drag this folder onto https://app.netlify.com/drop.
- **Vercel:** run `npx vercel --prod` in this folder.

Before you share the link, open it in a private window and run the judge walkthrough below.

## Judge walkthrough

1. Upload the workbook, or click "Try with sample data".
2. The status counts and the applications table show every decision. Click a row to see its checks in order, the score breakdown, the plan and a draft message to the applicant.
3. Ask "Why is APP-007 on hold?" or "What would APP-007 need to change to move forward?".
4. Type "APP-012 has now found a ground-floor space". The page shows the proposed field change and the effect on every applicant. Click **Apply change**. In the sample, APP-012 moves from Waitlist to Approved and APP-013 is bumped from Conditional to Waitlist (a knock-on effect). The change is recorded in Change history.

## Rules and defaults that need the brand's approval

Set in `CONFIG` in `engine.js`:

- City-tier investment minimums: Tier 1 ₹30 lakh, Tier 2 ₹20 lakh, Tier 3 ₹15 lakh.
- Site-ready minimum: 250 sq ft. Ideal size: 300–600 sq ft.
- Conditional slots are held for 30 days.
- Score weights follow the team's one-page plan. The "−5 next to a new store" rule is not built, because there are no coordinates to measure distance.
- Buddy store: the nearest store by PIN number in the same city. Tumakuru uses Bengaluru and Davanagere uses Hubballi-Dharwad.

## Not built (by design)

- **No Gemini.** Follow-ups use a deterministic parser for the brief's phrasings. Anything it can't parse gets a clarifying question; it never guesses.
- No live verification (DigiLocker, lender partner), no saving between visits, no translation of messages. Drafts say which language to send them in.
