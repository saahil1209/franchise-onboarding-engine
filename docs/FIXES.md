# Fixes: status

Tracks `docs/FIX_PROMPTS.md` against the 42-candidate test kit (`tests/fixtures/`). First run: 28 of 42 handled sensibly.

## Decisions applied (proposed defaults, need brand sign-off)

| Decision | Applied as |
| --- | --- |
| Proximity | Brand review when a winner's PIN is next to an existing store or another winner. **Interim:** "next to" means the same city and PIN numbers 1 apart, because PIN coordinates aren't loaded yet. Target: 2 km between PIN centroids. |
| Conditional holds | Honoured for 30 days. A recompute can't take a held slot; anyone who overtakes the holder waits next in line. |
| Launch horizon | Over 12 months: Waitlist, "re-apply closer to launch". 0 months: "as soon as possible", with a realistic date. |
| Plausible ranges | Investment ₹1–200 lakh, space 50–3,000 sq ft, experience 0–60 years, launch 0–60 months. Outside the range: On hold, "please confirm". The space minimum is 50, not 100, so that an 80 sq ft shop is judged on size (not big enough to be site-ready) rather than treated as a typo. |
| PIN in two territories | Goes to the higher-priority territory, then the lower ID. Stated in the reason, the upload notes and the territories table. |
| Owned vs rented | Score the same (15/15). |
| Blank name | A note, not On hold (the name never affects the decision). Blank business, or a blank size for an owned or rented space, puts the application On hold. |
| New statuses | **Brand review** (holds a slot; the brand must clear the flags) and **Withdrawn**. |

## Done (deterministic, no AI)

- **F2:**
  - required fields and plausible ranges
  - duplicates (same name, PIN, investment, business and space; only the earliest ID competes, even after it withdraws)
  - the launch horizon
  - the two-territory PIN rule
  - Conditional holds
  - proximity: interim, see above
- **Free text:** the rules now look for meaning rather than exact phrases. They catch:
  - still searching for a space
  - a different PIN in the text
  - years in the text vs the experience field
  - money already paid (fraud flag, plus a warning in the applicant's message)
  - a rival franchise
  - someone else running the store
  - a loan not yet sanctioned
  - funds from selling an asset
  - text that tries to instruct the system (ignored)
  - Kannada or Hindi text (flagged for a human reader)
- **F4 (rule-based):**
  - name lookup
  - who holds a PIN
  - territory and city/status lists
  - withdrawal, changes to a territory's open slots, undo, history
  - refusals for overrides, payback questions and requests to use language or other protected traits in decisions
  - clarifying questions for missing details
  - warnings when an update moves into a PIN that is already taken
  - previews that show only status changes, with rank changes listed separately
- **F5 (rule-based):** the "Today's summary" panel, with "Needs your attention" items that open the record.
- **F6:**
  - applicant messages never name other applicants
  - rejection advice lists only cities with open territories whose minimum fits
  - "1 year" / "1 month" grammar
  - the "How decisions are made" text is rewritten
  - drafts are labelled "English draft; translate before sending"
- **F1 (partial):** the session survives a refresh (sessionStorage), and a "Start over" button clears it. The privacy notice is accurate (nothing leaves the browser).

**Result:** the automated suite (`cd app && node --test`) checks every answer-key row that has a clear expected status, its flags and explanations, the shuffled file giving identical results, and F01–F40 in order. It passes.

## Not done yet

- **Gemini (F1 route, F3 extraction, F4 phrasing, F5 wording, F6 translation).** Needs `GEMINI_API_KEY` in the Vercel project's environment variables (server-side). The rule-based reading above stays as the fallback.
- **PIN centroids for a real 2 km distance check.** The All India Pincode Directory download from data.gov.in was blocked in this environment; it needs to be fetched and bundled with its licence noted.
- Manual accessibility pass (keyboard and screen reader).
