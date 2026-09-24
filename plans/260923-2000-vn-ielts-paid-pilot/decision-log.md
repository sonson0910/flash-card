# VN IELTS paid-pilot decision log

This is the dated evidence/decision record for Phase 11. Secret values, tokens, emails, UIDs, card/passage text and raw model responses must never be recorded here. **W0 is not passed; G1 is not authorized.**

## 2026-09-23 — W0 staging preparation and smoke status

- **Decision:** continue W0 preparation only. Do not start G1, onboard learners, deploy production, or claim staging smoke readiness.
- **Staging identity:** project `sonflash-staging-20260906`; named Firestore database `ai-studio-945b4052-4462-4668-8936-277f09f07a37`; region `asia-southeast1`; Web app `1:890120640842:web:f8a858029dc582fc7e49b3`; Auth domain `sonflash-staging-20260906.firebaseapp.com`; Hosting origin `https://sonflash-staging-20260906.web.app`.
- **Readback evidence:** gcloud described the exact staging database in `asia-southeast1`; Firebase CLI listed the staging project; Firebase SDK config matched the supplied Web app ID; the staging App Check Enterprise key's allowed domains were exactly the staging `.web.app` and `.firebaseapp.com` domains; Hosting returned HTTP 200. Google sign-in and authorized Auth domains were owner-confirmed, not independently exercised in a browser.
- **Local preparation:** `.firebaserc` gained only the additive `staging` alias; default remains `encoded-hangout-433912-h2`. Staging target config, explicit Vite build selection, fixed-project deploy commands and release-target validation are present. Production defaults/values and protected production deployment workflows were not changed.
- **Secret handling:** staging Secret Manager has an enabled version for both `ANALYTICS_PSEUDONYM_KEY` and `GEMINI_API_KEY`; the analytics key version was created for W0 and neither value was read or displayed. The Gemini secret's key provenance/binding is unverified. Read-only Cloud checks report the staging project has billing enabled but `generativelanguage.googleapis.com` is not enabled there; the Gemini key's reported project `named-sunset-433912-j1` has billing disabled and the API enabled. Do not use that key or enable APIs/billing without explicit owner action; AI Studio quota and paid-tier status remain unverified.
- **Smoke — NOT RUN / BLOCKED:** Google sign in → capture one word → review one card was not performed; there is no staging smoke record. Owner-reported Gemini key is associated with `named-sunset-433912-j1`, whose billing is not enabled and current AI Studio quota has not been verified. No fallback model is permitted; only `gemini-3.1-flash-lite` is allowed. No staging deploy was performed by this preparation.
- **W0 outcome:** **BLOCKED / NOT PASSED.** Required next evidence: intended-project Gemini key, paid billing and quota confirmation; owner-authorized staging deploy; browser smoke with persisted capture/review and meter evidence; budget alert decision and confirmation; dated aggregate smoke record. A read-only staging budget lookup was unavailable and did not change billing or budgets.
- **Pending owner choices:** static guide vs shared document; feedback channel; budget alert amount/account and recovery/monitoring owner. No guide was published. Production legacy shared decks were not queried.

## 2026-09-24 — Phase 03 local implementation (not a gate)

- **Scope completed locally:** card origin metadata (`ai` / `manual`) is normalized and persisted; spreadsheet imports mark manual cards and AI intake marks generated cards. Firestore rules accept supported origins and prevent clients from changing/removing an existing origin. AI disclosure is shown on the revealed card and browser-extension quick-add result.
- **Reporting implemented locally:** authenticated/App-Check `reportCard` callable validates bounded input, rate-limits to 30 reports per owner per hour, snapshots card details server-side, and writes private `card_reports`; client dialog is lazy-loaded and direct client access is denied by rules. User note is optional and capped at 280 characters.
- **Verification:** `npm run verify:core` passed (including 63 Firestore rules tests and Functions integration suites; emulator printed expected PERMISSION_DENIED and expression-limit diagnostics while exercising denial paths). `npm run verify:bundle` passed: initial JS 65,044 B gzip, CSS 28,057 B gzip; 63 JS chunks. Root and Functions TypeScript checks, Functions build, extension checks, targeted client/Functions tests and `git diff --check` passed.
- **Not complete / not approved:** privacy and terms pages, sign-in age copy, policy/contact/retention wording and owner review remain outstanding. This is local implementation evidence only; no staging/production deploy, cloud mutation, learner onboarding or commit was performed. It does not change W0: **BLOCKED / NOT PASSED**, and G1 remains unauthorized. Gemini paid-tier readiness remains deferred and unverified.

## 2026-09-24 — AI disclosure, report and policy pages (local follow-up)

- **Decision:** keep shared-deck adoption marked `origin: 'ai'` without changing legacy shared payload validation. This labels newly adopted cards while preserving old links. Keep reports for 180 days with a Firestore timestamp in `expiresAt`; enable the `card_reports` TTL only at the authorized G1 gate.
- **Local implementation:** the report action is visible on the back of Standard and Zen cards without expanding another panel. Vietnamese privacy and terms pages, English summaries, 18+ copy, policy links and the owner-provided temporary support email were added. The operations runbook now explains how to inspect and close open reports.
- **Verification:** focused client and Functions tests passed; `npm run verify:core`, `npm run verify:bundle`, `npm run extension:check`, and the Chromium `e2e/flashcard-remediation.spec.ts` suite passed. The bundle reported 65,044 B gzip initial JS and 28,192 B gzip initial CSS. Playwright checked report dialog visibility in Standard and Zen with reduced motion. No live report was submitted.
- **Open evidence:** the owner must review policy wording before G1/G2. A successful report submission and confirmation still require an authorized staging smoke with Google Auth and App Check; the local Playwright run tested the dialog opening, not a successful callable response. No cloud setting, deploy, Gemini call or production data changed. W0 and G1 remain **BLOCKED / NOT PASSED**.

## 2026-09-24 — Staging preparation verification (local)

- **Decision:** retain the prepared, explicit staging target and deploy commands as local tooling. W0 remains **BLOCKED / NOT PASSED** because the billed Gemini key, key-level quota, authorized staging deployment and browser smoke are still missing.
- **Verification:** `npm run verify:core`, `npm run verify:bundle` and `npm run extension:check` passed after the staging preparation. The release-target and staging-preparation tests ran within the core suite. The CSS bundle was 28,192 B gzip against the 29,500 B limit. No staging deploy command, cloud setting change or live Gemini request was run.

## Gate entry template

Copy one section per gate; leave status blocked until evidence is attached and the owner records a written go.

### <G1 / G2 / G2b / G3> — <UTC date>

- Status: BLOCKED / GO / HOLD / ROLLBACK
- Candidate revision and artifact digest:
- Owner's written go reference (required before any production deploy):
- Staging phase validations / smoke result:
- `npm run verify:core` result:
- `npm run verify:bundle` result (JS and CSS budgets):
- `npm run extension:check` (if extension changed):
- TTL `gcloud firestore fields ttls list` evidence (project + named database):
- Spend/allowance/quota or operator evidence, as applicable:
- Production smoke and observed meter movement, if authorized:
- Date/reason for config or rollout decision:
- Non-sensitive incident/correlation reference:

## 2026-10-23 — Pilot exit decision (future)

- Decision: CONTINUE / FIX / CHANGE ICP
- Metrics from the plan, with numerator and denominator:
- Cost, reliability, capture/review, retention and cohort feedback evidence:
- Follow-up backlog ranked by business reason:
- Owner decision reference:
