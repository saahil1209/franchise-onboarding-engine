# InCubeAte: franchise onboarding engine (Case 1 MVP)

A static web page. The judges upload the Case 1 workbook. Every applicant gets a status, the reason, the checks behind it, a score and next steps or an onboarding plan. Follow-up questions and new facts are typed into the box on the page.

Everything runs in the visitor's browser tab, so:

- there's no login and no server
- each judge's session is isolated
- uploaded data never leaves the browser

## Files

- `engine.js`: all the rules (reading the workbook, validation, gates, score, allocation, onboarding plans, follow-ups). It has no UI.
- `dashboard.js`: the figures on the Home dashboard and the map (counts, pipeline, score bands, queue, onboarding, cities), built from the live decisions. No UI.
- `map.js`: the territory map. Google Maps when the deployment provides a key; otherwise a drawn schematic of the cities.
- `api/maps-config.js`: a Vercel function that gives the page the Maps key from the project's environment variables.
- `app.js` and `index.html`: the page, in the glass design from `renders/glass/`. Views: Home, Applications, Territories, History & rules.
- `sample.js`: a provisional 23-row test workbook built from the brief's column list. Every row plants one edge case. The page has "Try with sample data" and "Download sample .xlsx" buttons.
- `engine.test.js` and `dashboard.test.js`: the tests. Run them with `node --test`.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. ES modules don't load from `file://`, so you need this server even locally. Locally there is no `api/maps-config`, so the map shows the drawn schematic.

## Google Maps

Set `GOOGLE_MAPS_API_KEY` in the Vercel project's environment variables and redeploy. (The function also accepts `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_KEY`, `MAPS_API_KEY` or `VITE_GOOGLE_MAPS_API_KEY`.) Optional: `GOOGLE_MAPS_MAP_ID` for a styled map; without it the page uses Google's `DEMO_MAP_ID`.

A Maps JavaScript key is visible in the browser by design. In Google Cloud, restrict it to this site's domain (HTTP referrers) and to the Maps JavaScript API. Markers are city-level and approximate; nothing from Google is stored.

## Deploy (a public link with no login)

The folder is static, so any static host works. Two options:

- **Netlify Drop:** drag this folder onto https://app.netlify.com/drop.
- **Vercel:** run `npx vercel --prod` in this folder.

Before you share the link, open it in a private window and run the judge walkthrough below.

## Judge walkthrough

1. Upload the workbook, or click "Try with sample data".
2. Home shows the headline figures, the territory map, who needs a person, and onboarding starts. Click a city on the map for its territories and ranked applicants. **Work through** opens the most urgent application.
3. Applications shows every decision. Click a row to see its checks in order, the score breakdown, the plan and a draft message to the applicant. **Download decisions** exports them as .xlsx.
4. On Home, ask "Why is APP-007 on hold?" or "What would APP-007 need to change to move forward?".
5. Type "APP-012 has now found a ground-floor space". The page shows the proposed field change and the effect on every applicant. Click **Apply change**. In the sample, APP-012 moves from Waitlist to Approved and APP-013 is bumped from Conditional to Waitlist (a knock-on effect). The change is recorded in Change history.

## Test kit

`tests/fixtures/` holds the 42-candidate workbook, its shuffled copy and the test kit (answer key and 40 follow-ups). `engine.test.js` runs all of them. What's fixed and what's left is in `docs/FIXES.md`.

## Rules and defaults that need the brand's approval

Set in `CONFIG` in `engine.js`:

- City-tier investment minimums: Tier 1 ₹30 lakh, Tier 2 ₹20 lakh, Tier 3 ₹15 lakh.
- Site-ready minimum: 250 sq ft. Ideal size: 300–600 sq ft.
- Conditional slots are held for 30 days.
- Score weights follow the team's one-page plan, with owned and rented space scored the same.
- Plausible ranges, the 12-month launch horizon, the 30-day Conditional hold and the two-territory PIN rule: see `docs/FIXES.md`.
- Proximity: winners next to an existing store or another winner go to Brand review. "Next to" means PIN numbers 1 apart in the same city until PIN coordinates are bundled.
- Buddy store: the nearest store by PIN number in the same city. Tumakuru uses Bengaluru and Davanagere uses Hubballi-Dharwad.

## Not built (by design)

- **No Gemini yet.** Notes and follow-ups are read by rules that look for meaning, not exact phrases. Anything they can't parse gets a clarifying question; they never guess. Gemini comes in once `GEMINI_API_KEY` is set in Vercel.
- No live verification (DigiLocker, lender partner), and no translation of messages. Drafts say which language to translate them into. The session survives a refresh but stays in the tab; "Start over" clears it.
