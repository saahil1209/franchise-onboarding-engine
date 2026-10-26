# Franchise Expansion Platform: Specification

October 2026 · India first · Multi-brand SaaS

## 1. What it is

A platform any franchising brand can use to (A) decide where to open franchises, (B) keep that plan current as rules, markets and consumer behaviour change, and (C) take and verify franchise applications for the locations it chooses. It recommends and verifies; the brand decides.

**Build first:** the hackathon Case 1 MVP (§6A), which is Flow C with bulk Excel intake, territory allocation and follow-up updates. Flows A and B follow after the hackathon (§12).

## 2. Users

| User | Needs |
| --- | --- |
| Brand (franchisor): founder, expansion head | Where to open, why, and how confident; a plan that stays current; a pipeline of verified applicants |
| Applicant (prospective franchisee) | A clear, trustworthy application; to know what's verified and what happens next |
| Platform admin | Data freshness, source health, integration health, costs |

## 3. Brand profile (input to everything)

- **Basics:** industry and category, products and price tier, store formats (size, frontage, floor), investment per store, royalty model, current stores (address or PIN, opened date, optional monthly sales).
- **Goals:** number of new stores and timeline; target regions or "anywhere in India"; target customer (income band, age, rural or urban); payback target; priorities (speed, profitability, brand presence); exclusions.
- **Guardrail settings:** minimum distance between stores, one store per PIN (default on), city-tier investment minimums.

## 4. Flow A: Recommend, then refine

1. Brand completes the profile.
2. The engine scores every candidate PIN in the target regions (§7).
3. Gemini writes a short reason for each top pick and lists what's missing that would change the result ("add your existing stores' sales to sharpen demand estimates").
4. The brand sees ranked PINs on a Google Map with scores, factor breakdowns, reasons and confidence.
5. The brand adds inputs: excludes areas, adds locations it's considering, adjusts goals or weights, uploads its own research.
6. The engine re-runs. Every run is a saved version; the brand can compare runs side by side ("what changed and why").

## 5. Flow B: Change Radar

**Trigger:** daily scan, plus on demand when a brand uploads research.

**Sources** (each tagged with tier: official, research, news):
- *Government:* Gazette of India and state gazettes, GST and tax notifications, state Shops and Establishments rules, municipal trade-licence and zoning changes, labour rules, sector rules (e.g. FSSAI for food).
- *Consumer behaviour:* MoSPI household consumption surveys, CPI and inflation releases, category price trends.
- *Market and people:* market research reports, news, and the brand's own uploaded user research.

**Processing:** dedupe; tag region, sector and effective date; match to brands whose categories, regions or goals it touches.

**AI:** Gemini (with Search grounding) reads each change and produces structured output: which goals it affects, direction, estimated magnitude band, confidence, effective date, and a plain-language summary with the source link.

**Change Impact Score** (per change, per brand, and per affected PIN), from −100 to +100:
- *Relevance* to the brand's sector, products and regions (0–1)
- *Direction* (helps or hurts)
- *Magnitude* band: effect on demand, cost or compliance (low, medium, high)
- *Confidence* by source tier (official > research > news) and by Gemini's evidence check
- *Urgency* by effective date

The weighting is deterministic code, tuned with evals; Gemini supplies only the classified inputs.

**Output:** an alert with summary, score, affected PINs and source; a proposed re-score the brand can accept; a weekly digest.

## 6. Flow C: Applications and verification

1. **Brand opens a location** (or a region) to applicants and picks the questions and documents it needs; the platform proposes defaults by category.
2. **Applicant applies** via a link: personal details, investment capacity and source (own funds, loan), retail experience, current businesses (full-time or not), space details (owned, rented, not yet; size; floor), target launch date, local ties, preferred language. Explicit consent per check.
3. **Verification** (each behind an interface with sandbox and mock adapters):
   - *Identity:* DigiLocker through a licensed vendor (decided; mocked until the vendor is chosen): Aadhaar (last four digits only), PAN, driving licence; GSTIN for existing businesses.
   - *Bank account ownership:* account verification via a licensed vendor.
   - *Funds, loan and credit:* via a regulated lender partner (bank or NBFC) using the Account Aggregator framework and credit bureau with the applicant's consent. The partner returns an attestation; the platform never stores raw statements. One adapter interface; the partner is chosen per brand in config. Switching partner mid-application needs fresh consent.
   - *Space documents:* lease or ownership document upload, checked by the brand.
4. **Screening** (deterministic): eligibility gates (tier minimum, verified funds, one store per PIN, distance from existing stores → human review), then a score (capital margin, full-time involvement, relevant experience, site readiness, local ties, launch realism). Gates and score are separate: a high score never overrides a failed gate. Gemini reads free text and flags contradictions; a flag sends the application to On hold with the question, never to Not eligible, and is never treated as proof of fraud.
5. **Screening outcomes** (recommendations, not decisions): Recommended (pending verification), Conditional (site needed, slot held N days), On hold (questions listed), Waitlist (alternatives offered, one at a time), Not eligible (gap stated and what would change it). Each outcome lists its evidence, its gaps and its next steps. If the Case 1 brief uses different labels, use the brief's labels and keep this meaning.
6. **The brand decides.** Only a brand action sets "Approved". Approved partners get an onboarding plan: agreement shared with a 14-day review before signing or paying; licences by state and city; fit-out; training track by experience; buddy store (nearest existing store); first 90 days of check-ins.

## 6A. Hackathon Case 1: bulk intake, allocation and follow-ups

The judge-facing MVP. Exact sheet and column names come from `docs/case1-brief.pdf` and `data/case1-template.xlsx`; this section only fixes behaviour.

1. **Workbook upload:** three sheets: Applications (applicant details, proposed city and PIN, investment capacity, experience, current or past business, space available, size, floor, launch timeline, language, free-text notes), Territories (territory ID, city, PINs covered, city tier, open slots, expansion priority) and Existing stores (a fixed list of ten). Accept the workbook as supplied. Read PINs as text (no lost leading zeros, no `560001.0`). Reject the whole workbook only if a sheet or required column is missing; otherwise process good rows and list every problem row with its reason.
2. **Screening:** §6 steps 4–5 on every application. Investment capacity from the workbook is a claim; outcomes that need verified funds say "pending verification".
3. **Allocation** (deterministic, independent of row order):
   - Link each application to a territory by PIN coverage; no match → explained, not dropped.
   - Existing stores occupy their PINs. At most one store per PIN, ever.
   - Order competing applicants by: gates passed, then score, then a stable tie-break on applicant ID. Fill territories in expansion-priority order, up to open slots.
   - Minimum distance uses open-data PIN centroids (§7); a conflict goes to human review, not rejection.
   - When no territory or slot is left, the outcome says so and offers Waitlist.
4. **Follow-ups:** questions ("Why is APP-007 on hold?", "What would it need to move forward?") are answered from the stored record and its computed reasons. New facts ("APP-012 now has a ground-floor space") become a proposed field change, which the user confirms; ambiguous ones get a clarifying question first. After confirmation, re-run allocation for the whole territory, not just the one applicant, and show what changed for every applicant affected, with before and after.
5. **History:** every upload, field change and recompute is logged with old value, new value, who and when.
6. **Onboarding:** every application that moves forward gets the §6 step 6 plan, adjusted to its outcome, experience, site readiness and language. Each item is marked suggested, outstanding, completed or needs brand approval. Nothing is shown as done (verification, licence, agreement, payment) unless it is.
7. **Public demo:** no login. Each browser session gets its own workspace with only its own uploads and edits, deleted after a short expiry. No real applicant data, no secrets in the client, no live verification calls.

**"Better inputs never worsen status"** applies to one applicant with everyone else held fixed. Exceptions to document and test: a new fact that reveals a gate failure (e.g. the new space is in an occupied PIN), and a change that triggers human review (e.g. proximity).

## 7. Scoring engine (Flow A and re-scores)

**Base geography:** All India Pincode Directory (data.gov.in, Government Open Data Licence) for PIN centroids, district and state (Case 1 needs the centroids for distance rules); Census and other open datasets for population and households. Google Maps adds geocoding, competitor counts (Places) and the map UI, within Google's caching terms.

**Factors per PIN** (each 0–1, with source and confidence):
- **Demand:** population and households in the catchment, urbanisation, growth proxies.
- **Consumer behaviour:**
  - *Spending level:* average monthly per-capita consumption expenditure (MPCE) by state and rural/urban from MoSPI's Household Consumption Expenditure Survey (HCES).
  - *Spending mix:* shares by item group (food, beverages and processed food, clothing, footwear, durables, conveyance, entertainment).
  - *Engel's Law fit:* Engel's Law says that as income rises, the share of spending going to food falls. The platform computes an area's food share (the Engel coefficient) and matches it to the brand's category: staples and value food brands fit areas with a higher food share; premium and discretionary brands (eyewear, apparel, electronics, cafés) fit areas with a lower food share and higher MPCE. Reference point: in HCES 2023-24, food was about 47% of rural and about 40% of urban spending.
  - *Trend:* direction of MPCE and category shares between survey rounds.
  - *Granularity rule:* HCES is reliable at state × rural/urban. Anything finer (district, PIN) is a modelled estimate and is labelled as such with lower confidence.
- **Competition:** count and density of same-category places nearby (Places API, counted, not stored).
- **Cost:** rent proxies by city tier and area, labelled as estimates; brand-provided rent data overrides. (A modelled commercial-rent estimate is an open question, §13: no open PIN-level rent dataset exists and the Places API gives no foot-traffic data.)
- **Cannibalisation:** distance to the brand's existing and newly recommended stores; overlap of catchments.
- **Brand fit:** match to target customer, format and goals.

**Ranking:** weighted sum with brand-adjustable weights, then guardrails (one per PIN, minimum distance, exclusions). **Demand model:** where the brand provides existing-store sales, fit a model (start simple: regularised regression or gradient boosting on the factors) and use it only where it beats the rule-based score in cross-validation.

**Payback (internal only):** investment ÷ expected monthly contribution, shown as a range with a downside case (revenue −20%) and written assumptions.

## 8. Gemini usage

| Task | Model tier | Output |
| --- | --- | --- |
| Explain picks; suggest missing inputs | fast | Structured JSON + short text, numbers checked by `numberGuard` |
| Change Radar classification | reasoning + Search grounding | Structured JSON with source links |
| Read applicant free text; flag contradictions | fast | Structured JSON (facts, flags); no status |
| Turn a follow-up message into a proposed field change, or a clarifying question | fast | Structured JSON (applicant ID, field, new value, confidence); applied only after the user confirms |
| Explain a computed screening outcome | fast | Short text from the stored reasons; numbers checked by `numberGuard` |
| Draft onboarding plans and messages | fast | Text from templates; no earnings figures |

**`numberGuard`:** every number in Gemini's output must match a number in the computed inputs it was given, after normalisation (thousands separators, ₹ and lakh/crore forms, percent vs fraction, rounding to the precision shown), or appear in that task's allowlist (e.g. 14-day review, 90 days, the applicant ID and PIN). Anything else fails the check: retry once, then show the computed result without the AI text.

Model IDs are not fixed in this spec; see `CLAUDE.md` (Gemini).

## 9. Guardrails

- The brand approves partners and plan changes; nothing automatic.
- No earnings promises to applicants; payback internal and labelled.
- Fraud notice on every applicant message: the brand and platform never ask for payment through unofficial channels.
- One live offer per applicant at a time; 14-day review before signing or paying.
- Proximity to existing stores goes to human review; the nearest existing partner may get first refusal (brand setting).
- Consent per check; DPDP retention and deletion; attestations, not raw financial data.
- Protected traits never scored.
- Google Maps caching terms respected.
- Every external fact carries source, date and level.

## 10. Brand dashboard

Ranked map; run comparison; Change Radar feed with scores; applicant pipeline by location and status; verification status per applicant; data freshness and confidence indicators.

## 11. Evals

- **Scoring:** for brands with existing-store sales, backtest whether higher-scored PINs match better-performing stores (rank correlation); sensitivity of top picks to weight changes.
- **Engel fit:** unit tests with known category and area profiles (staples vs premium) produce the expected ordering.
- **Gemini:** zero `numberGuard` failures; explanation faithfulness to factor breakdowns; Change Radar precision and recall on a labelled set of 100+ past notifications.
- **Screening (Case 1 suite, §6A):** the exact workbook format; incomplete and contradictory rows; competing applicants for one territory; occupied PINs and no two stores in one PIN; exhausted slots; missing PIN mappings; same result on re-run and with shuffled rows; status questions answered from the record; a follow-up that changes a decision (and its knock-on effects); better inputs never worsen status (with the §6A exceptions); planted contradictions caught; invalid AI output fails safely.
- **Isolation:** cross-tenant access tests; for the demo, cross-session tests (one session can't read another's uploads or edits).

## 12. Build slices

Hackathon slices (H) come first; platform slices (P) follow.

| Slice | Scope | Gate |
| --- | --- | --- |
| 0 — Kickoff | Design doc (no code) | Approved |
| H1 — Foundation | Repo, per-session demo workspace, design system from skills, app shell, audit log | Cross-session isolation tests pass; UI follows the skills |
| H2 — Ingest + screen | Exact workbook parsing and validation, PIN centroids, gates, score, outcomes with reasons | Workbook and screening tests; same result on re-run |
| H3 — Allocate | Territory matching, slots, priority, occupied PINs, distance → review, tie-breaks | Allocation tests; shuffled rows give the same result |
| H4 — Follow-ups + onboarding | Explanations, follow-up → confirmed field change → territory recompute, onboarding plans | Follow-up and monotonicity tests; zero `numberGuard` failures |
| H5 — Demo | End-to-end UI polish, public deployment | Judge walkthrough on the public URL |
| P1 — Tenancy | Auth, brand workspaces, row-level security | Cross-tenant isolation tests pass |
| P2 — Data layer | Census, HCES consumer profiles and Engel coefficients, Maps geocoding and Places counts within terms | Coverage report; sources and levels shown |
| P3 — Flow A | Profile, scoring, guardrails, Gemini explanations, map UI, refine loop, run versions | Scoring evals; zero `numberGuard` failures |
| P4 — Flow B | Source connectors, Change Radar pipeline, Change Impact Score, alerts, accept-re-score | Precision/recall on labelled set |
| P5 — Flow C intake | Location openings, form builder, applicant portal, consent records, fraud notice | End-to-end with mock verification |
| P6 — Verification | DigiLocker vendor, bank account check, lender partner attestation (sandbox) | Case 1 suite still green with verification on |
| P7 — Decisions + dashboard | Brand review, dashboard | Walkthrough with a pilot brand |
| P8 — Hardening | Security review, DPDP retention jobs, cost monitoring, load test | Sign-off |

## 13. Open questions

- Which licensed DigiLocker vendor?
- Which lender partner, and what attestation format they can return?
- Rent data source beyond city-tier proxies (a residential-rent × density × income model needs a rent dataset that doesn't exist openly at PIN level).
- Hackathon deadline and team size (sets how much of H1–H5 fits).
- Exact outcome labels and acceptance wording in the Case 1 brief.
- Do existing stores come with coordinates, or only PINs?
- `RETENTION_DAYS` value, and the demo workspace expiry.
- Pricing model for brands, and Gemini and Maps cost per brand per month.
- Which regions to launch in first.
