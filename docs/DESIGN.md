# Design decisions and open assumptions

Decisions taken while building, with who approved them.

## Flow A: recommend, then refine (October 2026)

**Placement.** Step 1 of the app (`#plan`): brand profile → ranked PINs → refine → re-run. Step 2 is the Case 1 applications upload. Approved by the product owner.

**Granularity.** Every PIN in the target states (PIN level). Approved by the product owner.

**Factor weights (approved):** demand 25, consumer spending 20, Engel's Law fit 15, competition 15, cost 10, distance from own stores 10, brand fit 5. The brand can change them in Refine. Weights are relative: a factor whose data isn't loaded is left out and the score is taken over the loaded weight, with the loaded share shown as "coverage".

**Defaults (approved by the product owner, 26 October 2026; brands can still change weights in Refine):**
- Priority nudges the defaults by 5 points: Profitability (spending +5, cost +5, demand −5, distance −5); Brand presence (demand +5, distance +5, cost −5, Engel −5); Speed (no change).
- Discretionary index for the Engel's Law fit: industry base (grocery 0.1, pharmacy 0.3, QSR 0.5, footwear and education 0.6, café, apparel and beauty 0.7, eyewear and electronics 0.8, other 0.5), Value −0.2, Premium +0.2. Fit = 1 − |index − (1 − normalised food share)|.
- Distance factor: 0 at the minimum distance, rising to 1 at three times it. A PIN closer than the minimum to an own store, or to an earlier pick, is not recommended.
- Brand fit, until spending data is loaded: the urban or rural target against the PIN's post-office mix (share of town offices). Low confidence.
- Default minimum distance between stores: 2 km.
- Spending and Engel's Law figures, once loaded, apply the state × rural/urban survey value to a PIN by its post-office mix; labelled as a modelled estimate.

**Data loaded:** PIN centroids, district and state from the All India Pincode Directory (see `data/SOURCES.md`). Office coordinates far from their district (3 × the district's median spread, at least 30 km) or from their PIN's other offices (25 km) are dropped; 349 PINs end up with no reliable location and are never recommended.

**Census 2011 (loaded, 26 October 2026):** Primary Census Abstract, district level (`data/build_census.py`). Present-day postal districts are matched to 2011 districts by exact name, a listed rename (e.g. Gurugram → Gurgaon, Bengaluru Urban → Bangalore) or a close spelling with the same direction words; 111 of 746 postal districts, created after 2011, have no match (90.7% of PINs covered). Demand per PIN = the district's 2011 urban households split over its PINs by their share of the district's town post offices (head and sub offices), plus rural households by their share of its village branch offices; normalised on a log scale; labelled an estimate, confidence 0.4. (An equal split over "urban-looking" PINs was tried first and rejected: districts with one urban PIN, like Raichur, put all their town households in it.) Where a split district kept its old name, the 2011 figure includes the area that left, so those PINs are overstated.

**Missing values within a loaded factor:** scored at the candidates' median with confidence 0.1 and labelled, so a PIN neither gains nor loses from missing data.

**Data not loaded yet (the factors show "not loaded"; nothing is guessed):**
- MoSPI Household Consumption Expenditure Survey 2023-24, state × rural/urban MPCE and food share (spending, Engel's Law). Source: mospi.gov.in.
- Competitor counts from Google Places (needs a working Maps key and a server function; counted, never stored).
- Rent: no open PIN-level dataset (SPEC §13); brand-provided figures are the likely route.
mospi.gov.in fails certificate verification from the build environment and data.gov.in drops the connection, so the spending survey must be committed to `data/` by hand.

**Not built yet:** internal payback ranges (need revenue assumptions from the brand), existing-store sales and the demand model, brand research uploads, the competitor layer on the map.

## Gemini

- SDK: `@google/genai` 2.28.0 (pinned). Called only from the Vercel function `app/api/explain.js`.
- Model (fast tier): `gemini-3.5-flash-lite`, stable. Checked at ai.google.dev/gemini-api/docs/models on 26 October 2026, which recommends 3.5 Flash-Lite or 3.8 Flash for new projects. Pinned in `app/api/_gemini.js`; `GEMINI_MODEL_FAST` in Vercel overrides it. Without `GEMINI_API_KEY` the page uses the engine's own reasons.
- Prompt `app/prompts/explain-picks.v1.js`, offline eval cases next to it. Structured output (JSON schema), validated, `numberGuard` on every reason and suggestion, earnings words rejected, one retry, then the engine's reasons.
- Prompts live in `app/prompts/` rather than the repo-root `prompts/` because Vercel deploys only `app/`.
- Cost guard: at most 10 picks and 40 KB per request. The public demo has no login, so anyone can trigger calls; add rate limiting before wider sharing.
