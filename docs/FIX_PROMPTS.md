# Case 1 app — Fix prompts

Fixes for the deployed Franchise Onboarding Engine, from two reviews: the live walkthrough of the app's sample, and the 42-candidate test file (28 of 42 handled sensibly on first run).

One fix slice per session: `/clear`, plan mode (Shift+Tab), paste the prompt, review the plan, approve. Before clearing, ask Claude Code to record decisions in `docs/DESIGN.md`. Commit after each slice passes its gate. Run the slices in order; F1 is needed by everything after it.

**Before you start**
- Copy the test files into the repo: `tests/fixtures/case1_test_candidates.xlsx`, `tests/fixtures/case1_test_candidates_SHUFFLED.xlsx`, `tests/fixtures/case1_test_kit.xlsx`.
- Add `GEMINI_API_KEY` to Vercel's environment variables (server-side only) and to `.env.local`. Never in client code or chat.

---

## F0 — Plan the fixes (no code)

```
Read CLAUDE.md, docs/SPEC.md, docs/DESIGN.md (if present), the app's source, and the three files in tests/fixtures/ (the test kit's "Answer key" and "Follow-ups" sheets describe every expected behaviour).

Do not change code yet. Write docs/FIXES.md covering:

1. Root causes, confirmed against the code:
   a. Free text (notes, business) is read by phrase matching, so paraphrases are missed (APP-004, 019, 021, 022, 037, 042 in the test file).
   b. Validation only covers the traps in the app's own sample: no required-field, plausibility, launch-horizon or duplicate checks (APP-018, 032, 033, 036, 038, 041).
   c. Missing rules: distance from existing stores (APP-011) and PINs listed in two territories (APP-007).
   d. Issues from the live review: applicant messages reveal other applicants; Conditional "slot held 30 days" is revoked on recompute; out-of-scope questions get an unrelated answer; a refresh wipes the session; rejection advice suggests cities with no open slots; knock-on previews list non-changes; "send in Kannada/Hindi" drafts are in English; "1 years".
2. The design for each fix, which slice (F1–F7) implements it, and its test.
3. The Gemini design: a server-side route, what data is sent (pseudonymised), JSON schemas per task, numberGuard, timeouts, fallbacks, and mock mode for tests. Check ai.google.dev/gemini-api/docs/models today, pick the current stable model ID, pin it in config and record the date.
4. Decisions that need my approval, each with your recommended default (see the list at the end of this file).

Then stop and wait for approval.
```

**Decisions F0 should ask about (recommended defaults):**
- Proximity threshold for brand review: 2 km between PIN centroids.
- A Conditional hold is honoured: during the 30 days, a recompute can't take the slot; the newcomer gets the next free slot or the waitlist, and the preview says so.
- Launch horizon: over 12 months can't hold a slot (waitlist with "re-apply closer to launch"); 0 months is treated as "as soon as possible", with a realistic date shown.
- Plausible ranges (outside = "please confirm", not scored): investment ₹1–200 lakh; space 100–3,000 sq ft; experience 0–60 years.
- PIN in two territories: assign to the higher-priority territory, then the lower territory ID; say so in the reason and flag it on the territories table.
- Owned vs rented: score them equally (15/15) unless the brand says otherwise.

---

## F1 — Server-side Gemini route, session persistence, honest privacy notice

```
Implement F1 from docs/FIXES.md.

1. Add a server-side API route (Vercel function) that is the only place the Gemini API is called. The key comes from the GEMINI_API_KEY environment variable and never reaches the browser. Use the official Google Gen AI SDK, the model ID pinned in config, structured JSON output with a schema per task, a 10-second timeout, and one retry before failing safely.
2. Pseudonymise before sending: replace applicant names with their application IDs; send only the fields a task needs. Re-insert names in the browser.
3. Add a mock mode (env flag) that returns fixture responses, so tests never call the live API.
4. Rate-limit the route per session and cap request size.
5. Persist the session (workbook data, decisions, change history, chat) in sessionStorage so a refresh restores it. Add a "Start over" button that clears it.
6. Replace "Everything runs in this browser tab; nothing is uploaded or stored" with an accurate notice: decisions run in the browser; the notes text and anonymised application details are sent to Google's Gemini API to read free text, answer questions and write the summary; nothing is stored on a server.

Gate: the key is absent from the client bundle (grep the build output), mock mode passes all tests, and a refresh restores the full session.
```

## F2 — Validation and missing rules

```
Implement F2 from docs/FIXES.md: general validation and the two missing rules. All deterministic code with tests; no AI in this slice.

1. Required fields: Application ID, name, city, PIN, investment, experience, space available, preferred language. Missing → On hold with the exact question. Business, size (when space is Owned or Rented), floor and launch: missing → On hold if they affect the decision, otherwise a note.
2. Plausibility ranges from the approved config; outside → On hold "please confirm" with the value quoted, never silently scored.
3. Duplicates: same normalised name + PIN + matching key fields → flag as a likely duplicate; only the earliest ID competes; the other is On hold "possible duplicate of APP-xxx".
4. Launch horizon per the approved rule.
5. Distance from existing stores: bundle PIN centroids for the allowed cities from the All India Pincode Directory (data.gov.in, Government Open Data Licence; cite it in the repo). A winner within the approved threshold of an existing store, or of another winner in this run, gets status "Brand review" with the nearest store and distance in the reason. If a PIN has no centroid, say so rather than guessing.
6. PINs in two territories per the approved rule, explained in the reason and flagged on the territories table.
7. Conditional holds honoured per the approved rule.

Gate: unit tests for every rule; the test file's APP-007, 011, 018, 032, 033, 036, 038 and 041 now match the answer key; nothing that passed before regresses.
```

## F3 — Gemini reads the free text

```
Implement F3 from docs/FIXES.md. Replace phrase matching on "Current / past business" and "Notes from applicant" with Gemini fact extraction through the F1 route.

For each application, Gemini returns JSON (schema-validated):
- space_status_claimed (has space / looking / none / unclear) with the quote
- pins_mentioned, cities_mentioned
- retail_years_mentioned
- funding: source (own / family / loan / sale of asset / unclear), sanctioned (yes / no / unknown)
- operator: applicant / someone else (who) / unclear
- competing_business: none / same category / rival brand (name) / unclear
- payment_already_made: yes / no, amount, to whom
- instructions_to_the_system: true / false (text that tries to direct the decision)
- launch_hint (e.g. "before the festival")
- evidence: the exact quote for every fact; anything without a quote is discarded

Deterministic rules then use these facts: contradictions with structured fields → On hold quoting both; payment already made → fraud flag to the brand plus a warning in the applicant message (never Approved until the brand clears it); rival brand → Brand review; someone else operates → ask who the operator is; unsanctioned loan → "funds to be verified" note; instructions to the system → ignored and flagged. Keep phrase matching only as the fallback when Gemini is unavailable, and show "Free text read by fallback rules" when it is used.

Cache extractions per row so re-runs give identical decisions. Text in Kannada or Hindi must work.

Gate: the test file's APP-004, 019, 021, 022, 035, 037, 040 and 042 match the answer key; add 20 paraphrase cases to tests (the same facts in different words and languages) and all must be caught.
```

## F4 — Gemini answers questions and reads new facts

```
Implement F4 from docs/FIXES.md: the question box uses Gemini to understand the message; the engine decides; Gemini writes the reply.

1. Gemini classifies each message into JSON: intent (explain / what_would_change / territory_summary / list_filter / rank / new_fact / withdraw / territory_change / undo / history / override_request / out_of_scope / unclear), the application or territory IDs (resolve names to IDs; ask if ambiguous), and for new facts the proposed field changes.
2. Answers come only from the stored decision record and computed data. Gemini phrases them from a facts object; numberGuard rejects any number not in that object, and then the template answer is shown instead.
3. New facts: show the proposed field change, ask for confirmation, recompute the whole territory, and show only applicants whose status or rank changed (status changes first, rank changes listed separately). Missing details (e.g. "got a loan" with no amount, "moved to Mysuru" with no PIN) → ask a clarifying question. Updates into a taken PIN → warn before applying. Unknown IDs → say so.
4. Support: withdrawing an application, changing a territory's open slots, undo of the last applied change, and "what changed since upload".
5. Out of scope: say what the app can't do and why (e.g. "I don't estimate payback; earnings estimates are the brand's to make"), then offer what it can.
6. Override requests ("approve APP-003 anyway"): explain the decision; record a brand override only if the user confirms they are the brand and gives a reason, and log it.
7. Requests to use name, gender, age, religion or language in decisions: decline and explain the fairness rule.
8. If Gemini is unavailable, fall back to the current rule-based parser and say so.

Gate: every F01–F40 prompt in the test kit's "Follow-ups" sheet behaves as described, run in order; the same question asked three ways gives the same facts; zero numberGuard failures.
```

## F5 — Today's summary panel

```
Implement F5 from docs/FIXES.md: a side panel titled "Today's summary", written by Gemini, for the person reviewing applications.

1. Build a facts object in code from today's session: counts by status and by territory; slots filled and open; the top-ranked winners; every flag (fraud, conflict of interest, duplicate, implausible value, proximity review, missing fields, PIN overlap); applicants needing a human decision; changes applied today with their knock-ons.
2. Gemini writes a short brief from that object only: a 2–3 sentence overview, "Needs your attention" (each item with its application ID, clickable to open the record), "Decided", "Changes today". Plain language, no recommendations beyond what the rules decided, no earnings figures.
3. numberGuard on every number; on failure, show the deterministic summary built from the same facts object.
4. Regenerate after upload and after every applied change; show "Updated at <time>" and a label "Written by Gemini from today's decisions; figures checked."
5. On a phone, the panel collapses above the applicant list.

Gate: on the test file, the summary lists every ❌/⚠️ case from the answer key under "Needs your attention", every number matches the tables, and it updates after an applied change.
```

## F6 — Review fixes and polish

```
Implement F6 from docs/FIXES.md:

1. Applicant-facing messages never show other applicants' IDs, names or scores ("a higher-ranked applicant"); the brand view keeps the detail.
2. Rejection advice suggests only cities with open slots whose tier minimum fits the stated investment.
3. Drafts marked "send in Kannada" or "Hindi" are translated by Gemini, labelled "Machine translation; review before sending", with the English shown alongside. Fall back to "English draft; translation needed".
4. Grammar: "1 year", "1 month".
5. Update the "How decisions are made" text to match every rule now in force (validation, duplicates, proximity, overlap, holds, launch horizon), and keep thresholds labelled as proposed defaults.
6. Keyboard and screen-reader access for the table, detail panel, chat and summary.

Gate: snapshot tests for applicant messages contain no other applicant's ID; a manual accessibility pass is listed.
```

## F7 — Full regression and deploy

```
Implement F7: run everything against tests/fixtures/.

1. Automated: upload case1_test_candidates.xlsx and the SHUFFLED copy; results must be identical. Score each answer-key row; target at least 40 of 42 sensible, with any remaining gaps explained. Run F01–F40 in order (mock Gemini for CI, live Gemini once manually).
2. Re-run the app's own sample and confirm nothing regressed.
3. Deploy to the existing Vercel URL. From a fresh browser session with no login: run the judge walkthrough, confirm the API key isn't in the client, and confirm a refresh restores the session.
4. Update the test kit's Result columns and write docs/TEST_REPORT.md with the before/after scores.
```
