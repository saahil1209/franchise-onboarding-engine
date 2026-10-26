# Design decisions and open assumptions

Decisions taken while building, with who approved them. "Proposed" means a default that still needs the brand's sign-off.

## Flow A: recommend, then refine (October 2026)

**Placement.** Step 1 of the app (`#plan`): brand profile → ranked PINs → refine → re-run. Step 2 is the Case 1 applications upload. Approved by the product owner.

**Granularity.** Every PIN in the target states (PIN level). Approved by the product owner.

**Factor weights (approved):** demand 25, consumer spending 20, Engel's Law fit 15, competition 15, cost 10, distance from own stores 10, brand fit 5. The brand can change them in Refine. Weights are relative: a factor whose data isn't loaded is left out and the score is taken over the loaded weight, with the loaded share shown as "coverage".

**Proposed (need sign-off):**
- Priority nudges the defaults by 5 points: Profitability (spending +5, cost +5, demand −5, distance −5); Brand presence (demand +5, distance +5, cost −5, Engel −5); Speed (no change).
- Discretionary index for the Engel's Law fit: industry base (grocery 0.1, pharmacy 0.3, QSR 0.5, footwear and education 0.6, café, apparel and beauty 0.7, eyewear and electronics 0.8, other 0.5), Value −0.2, Premium +0.2. Fit = 1 − |index − (1 − normalised food share)|.
- Distance factor: 0 at the minimum distance, rising to 1 at three times it. A PIN closer than the minimum to an own store, or to an earlier pick, is not recommended.
- Brand fit, until spending data is loaded: the urban or rural target against the PIN's post-office mix (share of town offices). Low confidence.
- Default minimum distance between stores: 2 km.
- Spending and Engel's Law figures, once loaded, apply the state × rural/urban survey value to a PIN by its post-office mix; labelled as a modelled estimate.

**Data loaded:** PIN centroids, district and state from the All India Pincode Directory (see `data/SOURCES.md`). Office coordinates far from their district (3 × the district's median spread, at least 30 km) or from their PIN's other offices (25 km) are dropped; 349 PINs end up with no reliable location and are never recommended.

**Data not loaded yet (the factors show "not loaded"; nothing is guessed):**
- Census population by district (demand). Source: censusindia.gov.in or data.gov.in.
- MoSPI Household Consumption Expenditure Survey 2023-24, state × rural/urban MPCE and food share (spending, Engel's Law). Source: mospi.gov.in.
- Competitor counts from Google Places (needs a working Maps key and a server function; counted, never stored).
- Rent: no open PIN-level dataset (SPEC §13); brand-provided figures are the likely route.
These government hosts are blocked by the build environment's network policy; adding them to its allowed domains, or committing the files, unblocks the loaders.

**Not built yet:** internal payback ranges (need revenue assumptions from the brand), existing-store sales and the demand model, brand research uploads, the competitor layer on the map.

## Gemini

- SDK: `@google/genai` 2.28.0 (pinned). Called only from the Vercel function `app/api/explain.js`.
- Model: set `GEMINI_MODEL_FAST` in Vercel to a current stable model ID. **Not yet recorded:** the models page (ai.google.dev) is blocked from the build environment, so the ID and the date checked must be added here by whoever sets it. With no model set, the page uses the engine's own reasons.
- Prompt `app/prompts/explain-picks.v1.js`, offline eval cases next to it. Structured output (JSON schema), validated, `numberGuard` on every reason and suggestion, earnings words rejected, one retry, then the engine's reasons.
- Prompts live in `app/prompts/` rather than the repo-root `prompts/` because Vercel deploys only `app/`.
- Cost guard: at most 10 picks and 40 KB per request. The public demo has no login, so anyone can trigger calls; add rate limiting before wider sharing.
