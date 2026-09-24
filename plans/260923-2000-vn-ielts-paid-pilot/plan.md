---
title: "VN IELTS paid beta on Firebase (30 days; start date set by the owner)"
description: "Make capture-to-review reliable, grant Pro by operator and measure willingness to pay (the gateway waits for business registration), and meter AI cost per account, on the existing Firebase stack."
status: pending
priority: P1
effort: 19.75 developer-days plus about 1.5 days of pilot operations, plus founder time for interviews, onboarding and support
branch: fix/open-code-review-remediation-20260921
tags: [pilot, entitlements, quota, cost-ledger, analytics, privacy, gamification, firebase]
created: 2026-09-23
---

# VN IELTS paid pilot

> **Owner answers of 2026-09-23 (evening), which override the dates and the phase 09 scope below:**
>
> - **No fixed start date.** The owner is still working out the business model and wants to optimise
>   before a beta. No learners are recruited yet, and the developer, founder and recruiter are the
>   same person. Treat every calendar date in this plan (09-24 … 10-23) as a placeholder: W0 is the
>   first week of beta build work, onboarding starts only after G1, and the 30-day window starts at
>   the first onboarding. Re-date the plan once the owner sets the beta start.
> - **Phase 09 is deferred until after the pilot.** Review XP is already +2 for every rating, which meets
>   decision R3 client-side, and cheating on XP is unlikely among 30 invited learners. Only the
>   study recap is fixed so it shows the XP actually granted (0.25d, moved into phase 08).
> - **Measured on 2026-09-23** ([report](../reports/measurement-260923-2144-gemini-card-cost-and-availability.md)):
>   a card costs about $0.00056 with no thinking tokens, so the Pro quota is 1,000 a month. The 503
>   errors seen during the measurement come from the key being on the AI Studio trial (free) tier
>   (owner). **Use `gemini-3.1-flash-lite` only, with no fallback model.** Before the beta, the
>   Gemini key must move to a paid tier; that is a G1 go condition.
> - **Approved:** G2b for analytics, a final purge 65 minutes after deletion, streak owned by the client, and a
>   `getPilotOffer` callable.

## Execution status — 2026-09-24

The local implementation for phases 01–08 and the phase 11 staging/runbook preparation is committed
on the plan branch. Phase 09 and phase 10 remain deferred by the owner; the cohort guide is also
deferred until recruitment. [The decision log](decision-log.md) records verification after each
phase. **W0 has not passed:** the billed Gemini key/quota, authorized staging release and live smoke
are missing. G1, G2, G2b and G3 are blocked in sequence; no production rollout, learner onboarding
or pilot metric decision has happened. The calendar dates below are placeholders until the owner
sets the beta start.

## Outcome

By 2026-10-23 about 30 Vietnamese adults (18+) who study IELTS Reading on a laptop use SonFlash to
capture words from their own reading, review them on a laptop or phone, and can ask to buy Pro at
79,000 VND plus VAT (Pro is granted by the operator until the business is registered and a gateway
is added). Every AI call is metered with real token counts, each account is held to its monthly AI
card quota and its daily allowance for other AI actions, and global Gemini spending cannot exceed
about $5 a day. The founder ends the pilot with a cohort funnel (numerators and denominators), real
cost per card and per user, the list of problems that block value, and the names of learners who
asked to buy and kept reviewing.

> **Owner answers of 2026-09-23 change this plan:**
>
> - **No payment gateway in the pilot.** The owner adds one after registering the business. Pro
>   is granted by the operator (phase 04 is cut to entitlements, the operator tool and an honest
>   purchase-intent dialog), and willingness to pay is measured by intent and interviews, not by
>   checkout.
> - **79,000 VND excludes VAT.** The price shown to learners must be the final amount; the
>   accountant confirms the rate and how to show it before any sale.
> - **App Check stays as it is in the pilot.** The console enforces App Check for Firestore or
>   Auth, so the lazy start is unsafe, and after the red team review the TTL raise is removed too
>   (red team #15). Phase 10 is deferred and G4 no longer exists.
> - **Staging calls the real Gemini model,** so the W0 cost measurement can run on staging.
> - **Non-card AI actions** (`translate`, `story`) get their own per-account daily allowance, Free
>   20 and Pro 200, not counted against the card quota, plus a per-account share of about 20% of
>   the daily spend cap (red team #1).
> - Proposed defaults for questions 3, 4, 6, 7 and 10 apply unless the owner changes them.

Owner decisions: [decisions.md](../260923-1831-global-multilingual-launch/decisions.md), revisions
R1-R5. Sources: [GPT review](../reports/gpt-strategy-response-260923-1948-business-review.md) (§3
P0 list, §D schedule and metrics), [comparison](../reports/review-260923-1949-gpt-strategy-response-vs-decisions.md),
[unit economics](../reports/unit-economics-260923-2010-pricing-and-infrastructure.md),
[Firebase cost audit](../reports/firebase-cost-audit-260923-1854-measured-usage-projection.md),
[red team review](../reports/red-team-260923-2030-vn-ielts-paid-pilot.md).

## Scope

In scope: the P0 items below, on Firebase Auth (Google only), Firestore, Cloud Functions
(`functions/src/index.ts`), the web app and the existing extension. English target, Vietnamese
meanings. All existing flashcard effects stay (tilt, spotlight, aura, 3D flip, star pop, blind blur,
audio waves). New UI ships as lazy chunks so the initial JS bundle keeps its ~6 KB gzip headroom;
CSS is one Tailwind v4 file with only ~1.5 KB gzip headroom, which lazy chunks do not help
(red team #14).

Out of scope: backend rewrite, email/password, new target languages, new UI locales, PDF/EPUB,
tutor, paid pronunciation, Max, public league, cosmetic store, native app, a shared AI result cache,
a payment gateway and checkout (after business registration), and any App Check change (phase 10,
deferred).

**The redesign is not a pilot gate.** No phase of the
[frontend plan](../260923-1831-global-multilingual-launch/frontend/plan.md) is needed. The pilot
builds three small surfaces that its phases will later restyle or replace: the plan usage meter and
upgrade dialog (a minimal forerunner of frontend phase 20), the card edit dialog (phase 09 restyles
it), and the account data section (phase 12 absorbs it). Any new copy follows the rule that the
anime theme uses no game or MOBA words.

## Findings from scouting that shape the plan

| Finding | Evidence | Consequence |
|---|---|---|
| AI generation and card saving are separate calls; the server cannot see which generation became a card | `generateVocabulary` `functions/src/index.ts:318-408`; `createCard` `:514-547`; client calls both from `src/features/intake/cardIntakePipeline.ts:501-506` and `:584-595` | A "completed card" is counted when the server returns a valid `word` result. An operation id from the client keeps retries free |
| `translate` accepts any prompt up to 2,048 characters and backs five features | `translateText` `src/lib/gemini.ts:92`, used by `WordExtractorModal`, `AiDialogueModal`, `CardAiAssistantModal`, `CardMnemonicSection`, `Flashcard.tsx:458` | Separate per-account daily allowance and spend share (phases 01, 02; red team #1) |
| The callable parser rejects unknown fields | `assertAllowedFields`, `functions/src/inputValidation.ts:186` | New request fields ship expand/contract: functions before hosting, rollback in reverse (red team #4) |
| The client treats `aborted` as final | `src/lib/protectedFunctionsCapability.ts:147-163` | "Operation in flight" uses the retryable `unavailable` code (red team #2) |
| No AI result cache exists | `generateVocabulary` calls Gemini on every request; the intake only reuses cards already in the library (`src/features/intake/cardIntakeController.ts:289`) | "Cache hits count" is kept as a rule; nothing to build |
| Review XP is already 2 for every rating, but it is computed by the client and applied per review, not per card per day | `src/features/librarySession/libraryReplica.ts:347`, `src/features/learning/useLearningStatePersistence.ts:222`, `src/app/useAppLearningCoordination.ts:178-179`; the server accepts any client delta up to 1,000,000 (`functions/src/gamificationPersistence.ts:10`) and requires an exact stats key set (`:317-345`) | R3 means granting review XP in the strict review transaction, bootstrapping stats safely and capping client deltas (phase 09; red team #5, #6) |
| At 30 users App Check stays inside the free 10,000 assessments a month | Owner made 394 assessments in 30 days (cost audit) | No cost reason to touch App Check in the pilot; phase 10 deferred |
| No staging deploy target exists in the repo | `.firebaserc` has only the production project; production ids sealed in `firebase-applet-config.json` and `functions/src/runtime-target.json` | W0 staging setup before any G1 step (phase 11; red team #8) |
| No card text editing UI exists; the patch protocol already allows it | `mutableCardFields` in `src/lib/cardMutationProtocol.ts:15`; no editor component in `src/components` | Phase 07 builds a small edit dialog on the existing patch path |
| Card export exists (spreadsheet); account deletion does not | `src/features/importExport/useLibraryExport.ts:49`; no delete-account code | Phase 06 adds account data export and deletion |
| No analytics exists | no `logEvent`/analytics import in `src` | Phase 05 stores allowlisted events server-side; no GA SDK (bundle budget) |

## Phases

| # | Phase | Effort | Blocked by | Release | Target date |
|---|---|---|---|---|---|
| 01 | [Cost ledger, daily spend cap, pilot config](phase-01-cost-ledger-spend-cap-and-pilot-config.md) | 2d | 11 staging setup (staging steps only) | R1 | 2026-09-26 |
| 02 | [Account AI quota with idempotent operations](phase-02-account-ai-quota-and-idempotent-operations.md) | 3d | 01 | R1 | 2026-09-29 |
| 03 | [AI disclosure, report a wrong card, policy pages](phase-03-ai-disclosure-report-and-policy-pages.md) | 1.25d | none | R1 (report dialog, terms by R2) | 2026-09-30 |
| 04 | [Entitlements, operator grant, purchase intent](phase-04-gateway-selection-entitlements-and-payments.md) (gateway deferred) | 2d | 02 | R2 | 2026-10-02 |
| 05 | [Privacy-safe analytics and pilot metrics](phase-05-privacy-safe-analytics-and-pilot-metrics.md) | 2d | 01, 02, 04 | R2 | 2026-10-07 |
| 06 | [Account data export and deletion](phase-06-account-data-export-and-deletion.md) | 2.5d | 04, 05 | R3 | 2026-10-10 |
| 07 | [Capture, card, edit reliability](phase-07-capture-card-edit-reliability.md) | 3.25d (1d in W0) | none (edit: 03; retry check: 02) | R1 triage, R3 edit | triage 09-30, edit 10-09 |
| 08 | [Mobile review](phase-08-mobile-review.md) (+ recap XP fix) | 1.75d | none | R3 | 2026-10-13 |
| 09 | [Review XP: Again equals Good, server-verified](phase-09-review-xp-server-verified.md) | **deferred, after the pilot** (2.75d) | — | — | — |
| 10 | [App Check changes](phase-10-app-check-lazy-start.md) (deferred, not in the pilot) | 0d | n/a | none | n/a |
| 11 | [Staging setup and verification, go gates, pilot operations](phase-11-staging-go-gates-and-pilot-operations.md) | 2d (W0 staging setup 1d + preparation 1d) | each release | all | staging setup 09-24 |

Total 19.75 developer-days (2 + 3 + 1.25 + 2 + 2 + 2.5 + 3.25 + 1.75 + 0 + 0 + 2); phase 09 (2.75d) is deferred. Pilot
operations (gates and daily checks) add about 1.5 days, counted separately (red team #9). The
earlier total omitted phase 11 and predates the red team fixes.

## Roles

One developer builds every phase. The founder runs interviews, recruiting, onboarding and support,
and gives each gate's go. If the developer and the founder are the same person (open question 14),
W0 holds about 8 days of development plus 12 interviews for one person, which is why the W0 cut line
below is agreed in advance.

## Timeline aligned with GPT's weekly schedule

| Week | Product work | Founder work (GPT §D) | Gate |
|---|---|---|---|
| W0: 09-24 to 09-30 | Staging setup first; 01, 02, 03, 07 triage (1d); measure the real cost per card on staging | Interview 8 VN learners and 4 Japanese learners (at least 6 in W0 if one person does both roles); recruit the cohort | **G1** on 09-29/30 |
| W1: 10-01 to 10-07 | Items below the W0 cut line; 04 (entitlements, operator grant, purchase intent); 05 | Onboard about 30 learners on their own reading; offer Pro and record purchase intent | **G2** 10-02, **G2b** 10-07 |
| W2: 10-08 to 10-14 | 07 edit dialog, 08, 09, 06 | Watch the cohort; ask non-askers why; watch learners hit the quota | **G3** 10-14 |
| W3: 10-15 to 10-23 | Feature freeze (at the latest 10-17, see below); blocker fixes; metrics | Close cohorts that have aged; interview leavers; decide continue, fix or change ICP | none |

## Honest fit and the pre-agreed W0 cut line

It does not all fit. W0 holds about 6 working days (7 calendar days). R1 (staging setup, 01, 02, 03
and the 1-day capture triage) is 8.25 developer-days (red team #9). The whole plan is 22.25
developer-days plus 1.5 days of operations inside 30 calendar days, with W3 meant as a freeze.

**W0 cut line, agreed before work starts.** Above the line, required before any real learner
(G1):

- W0 staging setup and smoke (phase 11);
- phase 01 in full;
- phase 02 server side (quota, operation records, attempt ids, sweeper, non-card allowance) and the
  client operation id, draft reuse and error mapping;
- phase 03 `origin` with its rules change, the disclosure line and the privacy page;
- phase 07 fixes for triage failures that lose a word or block a save.

That is about 6.5 developer-days, so it fits only with weekend work. Below the line, moved to
10-01..10-05 without blocking onboarding: the usage meter UI (02), the report dialog and the terms
page (03; the terms page is still required before G2), the other triage items (07), and interviews
beyond the first 6. If the items above the line are not live on production by 10-01, onboarding
moves day by day; no real learner joins before the spend cap, quota and allowances are live.

**Later slips.** If a phase slips past 10-14, cut in this order: the recap polish in 09, 08's
non-blocking items, the library-row edit entry in 07 (the card-back entry stays). If that is not
enough, the owner chooses between moving 09 after the pilot and moving the freeze to 10-17. Do not
cut 01, 02, 04, 05 or 06.

**Minimum sample for D7.** D7 is read as a decision signal only if at least 20 ICP learners (not
the founder or friends) signed up by 10-15, so their day 8 falls by 10-23. With fewer, D7 is reported
as anecdotal and the 10-23 decision rests on activation, capture-to-review and interviews.

## Dependencies

- 11 staging setup → every G1 staging step.
- 01 → 02 → 04 (quota reads the plan summary that 04 writes; 02 defines its schema and treats a
  missing document as Free).
- 01, 02 → 05 (ledger, refusals); 04 → 05 (`analyticsEvents.ts` and `purchase_intent` start in 04);
  04, 05 → 06 (operator tool, audit, events to delete).
- 03 → 07 edit dialog (`origin` in the rules key list); 02 → 07 retry check (operation id on the
  intake draft). 07 triage runs on the current build and merges after 02's intake change.
- 08 and 09 are independent of the money path and of each other.
- **One developer, sequential merges.** Phases 01-06 and 09 all edit `functions/src/index.ts`;
  02, 03, 04 and 06 edit `firestore.rules`; 02, 03 and 07 edit `src/features/intake/*`; 04 and 06
  edit `functions/src/pilotOperator.ts`; 04 and 05 edit `functions/src/analyticsEvents.ts`. Keep new
  logic in new modules and merge in phase order so index.ts only gains wiring. Do not run two of
  these phases on parallel branches.

## Data flows (summary; details in each phase)

- **Capture:** extension selection → worker tab of the web app → `generateWordInfo`
  (`src/lib/gemini.ts:70`) with the draft's `operationId` → `generateVocabulary`: hourly limits →
  reserve transaction (operation record, quota) → spend reservation (global and account day
  counters) → Gemini with a 45 s abort → ledger entry (tokens, cost) → spend correction → attempt-
  checked commit or refund → result → `createCard` callable (server emits `capture_completed`) →
  review queue. A sweeper refunds reservations left `reserved` after 10 minutes.
- **Other AI actions** (`translate`, `story`): hourly limits → daily allowance (Free 20, Pro 200) →
  spend reservation → Gemini → ledger → correction; a failure returns the allowance unit.
- **Review:** rating → existing persisted review path and FSRS update → the client settles the
  existing +2 XP review effect when the review commits. A queued review stays provisional and is
  excluded from the completed session recap. Server-verified XP is deferred with phase 09.
- **Pro (pilot):** upgrade dialog → `getPilotOffer` (quota, final price) → "Đăng ký mua khi mở bán"
  → `recordPurchaseIntent` → `purchase_intent` event; operator `grant` → entitlement and plan summary
  in one transaction, plus `operator_audit` → client sees Pro from `users/{uid}/profile/plan`.
  Checkout and webhook come after business registration.
- **Analytics:** server events from the ledger, `createCard`, review, quota, report, operator and
  intent code; three client events (`capture_started`, `capture_failed`, `paywall_viewed`) through
  `recordClientEvents`; all keyed by a pseudonymous id with per-user `cardRef` and hashed `opRef`;
  no sentences, URLs, prompts or raw ids. The cohort date comes from Auth `creationTime`.
- **Deletion:** revoke tokens → tombstone → shared decks → user data → uid-keyed records → Auth user →
  final purge after 65 minutes.

## Backward compatibility

- **Expand/contract for new request fields (red team #4).** `operationId` (top level of the
  `generateVocabulary` body) and `origin` (card create) are accepted by the functions and rules
  deployed before any hosting release sends them. Rollback goes hosting → functions → rules, and never
  to a functions or rules artifact that rejects a field the live client sends.
- Old cached web bundles call `generateVocabulary` without `operationId`: the server generates one,
  so quota still applies (their retries count twice, which is acceptable).
- **Review XP (red team #6).** Existing clients keep their client-owned +2 XP review operation.
  The `serverReviewXp` config field has no pilot behavior while phase 09 is deferred; it is not a
  rollback control for this release.
- Existing users have no plan document: missing means Free. Existing XP, cards and review history are
  not migrated or changed. Cards created before the pilot have no `origin` and show no AI line.
  FSRS scheduling is unchanged.
- The extension protocol (v3) is unchanged; no extension release is required unless the triage
  finds an extension-only blocker.

## Acceptance criteria (pilot delivery)

1. A Free account gets exactly 30 AI cards in a calendar month (Asia/Ho_Chi_Minh); the 31st is
   refused with a clear message, and reviews, manual cards and export keep working.
2. A retried generation with the same `operationId` never counts twice, including two concurrent
   requests and a manual retry of the same word; an in-flight duplicate gets a retryable answer; a
   failed generation never counts; a stale reservation is refunded by the sweeper. Proven by
   functions tests and an emulator test.
3. Every Gemini call reserves its worst-case cost before the call and writes one ledger entry with
   prompt, output, thinking and total tokens and an estimated cost; the daily total stops AI calls at
   the configured cap (default $5), and one account cannot spend more than its configured share
   (default 20%). A key-level quota in AI Studio is the last stop.
4. `translate` and `story` are limited per account per day (Free 20, Pro 200) without touching the
   card quota.
5. The operator grants a fixed 30-day Pro entitlement (no stacking) and the account gets the Pro
   quota at once; an operator revoke ends Pro; every grant and revoke is in `operator_audit`.
   Clients cannot write entitlements, the plan or audit records. The purchase-intent dialog shows
   the final price, records `purchase_intent` and never asks for payment details.
6. Quota values, allowances, the spend cap and share, token prices, the Pro quota (1,000 or 500),
   the display price and the feature flags live in one config document and change without a deploy.
7. Again and Good grant the same review XP (2, as the client does today), and the study recap shows
   the XP actually granted. Server-verified XP (phase 09) is deferred until after the pilot. FSRS
   results are unchanged.
8. A learner can edit a card's meaning (including AI cards), report a wrong card, export their data
   and delete their account; a second signed-in device cannot recreate data after deletion;
   AI-generated content is labelled.
9. Review works on a 360 px wide phone: all controls reachable, no horizontal scroll, touch targets
   at least 44 px, effects intact.
10. `npm run verify:core` and `npm run verify:bundle` pass for every release, with the CSS size
    inside its budget.

## Pilot metrics (from GPT §D14; thresholds are decision rules, not benchmarks)

| Metric | Definition | Signal |
|---|---|---|
| Activation 24h | Within 24 h of sign-up (Auth `creationTime`): ≥5 own AI captures and one completed review | ≥50% of ICP sign-ups good; <30% after onboarding fixes means rethink the workflow |
| D7 review retention | ICP sign-ups with a real review on day 6-8 | ≥25% worth pursuing; <15% investigate first; only learners whose day 8 has passed; a signal only with ≥20 eligible ICP learners |
| Capture-to-review 7d | Share of own captures aged ≥7 days reviewed at least once | ≥60% target; <40% means hoarding, not learning |
| Purchase intent | Learners (not the founder or friends) who press "Đăng ký mua khi mở bán" at the final published price and confirm in an interview that they would pay | ≥5 (better 10) who also keep reviewing; real payments start after business registration |
| Cost | Mean and p95 cost per AI card; cost per Free and per Pro MAU; daily spend; top accounts by spend | Pro quota set by the $0.001 rule; spend never hits the cap by surprise |
| Quality | Wrong-card reports per 100 cards; capture failure rate; p95 generation latency | Serious meaning errors fixed before scaling |
| D30 | Not available: 09-24 sign-ups age on 10-24 | Not a gate for 10-23 |

## Go / no-go for production changes

Nothing reaches production without the owner's explicit go at each gate. Details, checklists, TTL
commands and rollback steps are in [phase 11](phase-11-staging-go-gates-and-pilot-operations.md).

| Gate | Contents | Go when |
|---|---|---|
| G1 (09-29/30) | Items above the W0 cut line: 01, 02, 03, 07 triage fixes (rules, functions, hosting in that order); TTL on `ai_operations` and `ai_cost_ledger` | Staging setup and staging smoke done; staging checklist passes; verify:core and bundle budget (JS and CSS) green; spend cap and account share proven on staging by forced low values; key-level request quota set on the Gemini key in AI Studio; the Gemini key is on a paid tier (not the trial tier); `ttls list` output recorded |
| G2 (10-02) | 04 entitlements, operator grant and revoke, `getPilotOffer`, purchase intent; items below the W0 cut line | Operator grant and revoke tested on production on the owner's own account; one `purchase_intent` recorded on production; `displayPriceVnd` set from the accountant's answer; terms page live; rules tests prove clients cannot write entitlements |
| G2b (10-07) | 05 analytics; TTL on `analytics_events` | Staging event check (no private text); exclusion list filled |
| G3 (10-14) | 06, 07 edit, 08 (with the recap fix); TTL on `account_tombstones` | Staging checklist; recap test; deletion tested on a throwaway production account with a second signed-in browser |

## Key risks

| Risk | L × I | Mitigation |
|---|---|---|
| One account burns the global AI budget through `translate`/`story` | H × H before the fix | Daily allowance and per-account spend share (01, 02; red team #1) |
| Double charges from concurrent or manual retries | M × M | Transactional operation record, attempt ids, draft reuse, sweeper (02; red team #2) |
| Spend undercounted on timeouts | M × H | Worst-case reservation, 45 s abort, key-level quota (01, 11; red team #3) |
| New client meets old functions and capture fails for everyone | M × H | Expand/contract deploy and rollback order (red team #4) |
| Server XP grant breaks gamification saves | M × H | Stats bootstrap, receipt-based filter, flag rollback (09; red team #5, #6) |
| **CSS budget:** Tailwind v4 emits one CSS file with ~1.5 KB gzip headroom; lazy chunks do not help | M × M | Reuse existing utilities; CSS size checked at every gate; any new class set is weighed against the budget (red team #14) |
| W0 overload for one person | H × M | Pre-agreed cut line; onboarding waits for the protections |
| Too few learners for a D7 signal | M × M | Minimum 20 eligible ICP learners, else D7 is anecdotal |

## Rollback principles

Each gate is one rules deploy, one functions deploy and one hosting release, each with the previous
artifact kept, deployed in that order and rolled back in reverse. New behaviour sits behind config
values (`quotaEnforced`, spend cap and share, allowances, `analyticsEnabled`), so
most rollbacks are a config edit. A code rollback never returns functions or rules to a version that
rejects `operationId` or `origin` while a client that sends them may be live. New collections are
additive; phase 09's `xpAwarded` review-result change is outside this pilot.

## Red Team Review

### Session — 2026-09-23

Report: [red-team-260923-2030-vn-ielts-paid-pilot.md](../reports/red-team-260923-2030-vn-ielts-paid-pilot.md).
Four lenses (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity
Critic) raised 38 findings, merged into 16: 15 accepted, 1 rejected. Severity: 2 Critical, 10 High,
4 Medium (the rejected finding is Medium).

| # | Finding | Severity | Disposition | Applied to |
|---|---|---|---|---|
| 1 | Unlimited general AI through `translate`/`story` | Critical | Accepted; owner set Free 20/day, Pro 200/day, 20% spend share | 01, 02, plan.md |
| 2 | Operation idempotency does not hold (read outside the transaction, `aborted` final, takeover double charge) | Critical | Accepted | 02, 07 |
| 3 | Spend counted only after the call; timeouts never counted | High | Accepted | 01, 11, plan.md G1 |
| 4 | Parser rejects unknown fields; functions-only rollback breaks capture | High | Accepted | 01, 02, 03, 11, plan.md |
| 5 | Server XP grant can create a bad stats document; streak overwrite | High | Accepted | 09 |
| 6 | XP filter too blunt; "server-verified" not true; no rollback flag | High | Accepted | 09, plan.md AC7 |
| 7 | Deletion can be undone by another device; legacy decks; rate-limit documents; no resume | High | Accepted | 06 |
| 8 | No staging deploy target in the repo | High | Accepted | 11, plan.md |
| 9 | Effort total wrong; W0 overloaded; no cut line or D7 minimum | High | Accepted | plan.md, 11 |
| 10 | Analytics sinks missing or wrong (worker tab, `signup_completed`, intent at G2, duplicated cost) | High | Accepted | 04, 05 |
| 11 | Analytics can be re-identified (`operationId`, global `cardRef`, free text, client exclusion list) | High | Accepted | 05 |
| 12 | `origin` missing from the rules key list; heuristic mislabels manual cards | High | Accepted | 03, 07 |
| 13 | Operator tool and config contracts unclear (revoke, stacking, hard-coded project, audit, client config, VAT) | Medium | Accepted | 01, 04 |
| 14 | TTL needs `--database`, ledger TTL missing; CSS budget | Medium | Accepted | 05, 08, 11, plan.md risks |
| 15 | App Check TTL raise weakens the only anti-bot protection, no pilot benefit | Medium | Accepted; owner removed it from the pilot | 10, plan.md |
| 16 | Delete and recreate an account resets the Free quota | Medium | Rejected for the pilot: 30 invited learners watched daily; revisit with a carry-over record before public launch | none |

### Whole-Plan Consistency Sweep

Re-read plan.md and all eleven phase files after the edits and searched for stale terms. Reconciled:

- Effort: the old totals (17.25 and 20.5) appear nowhere except this note; plan.md frontmatter, phases table and total now read
  22.25 developer-days plus about 1.5 days of operations, matching the phase headers.
- G4: removed from the gates table, timeline, phase 10 and phase 11; phase 10 is "deferred, not in
  the pilot" with the reasoning paragraph; the owner-answers block and scouting table no longer
  describe a TTL raise or a lazy start as a pilot deliverable; question 8 is closed.
- Analytics: "four client events" became three client events plus the `recordPurchaseIntent`
  callable; `signup_completed` is gone and the cohort comes from Auth `creationTime`;
  `ai_card_completed` is thin and carries `opRef`, not `operationId` or cost.
- Payments: phase 04's body is the pilot scope only (entitlements, `grant`/`revoke`/`status`,
  `getPilotOffer`, purchase intent); `refund(orderCode)`, `reconcile`, `payment_exceptions`
  and webhook registration remain only under "Deferred until business registration", and stacking
  is replaced by a fixed-duration, no-stacking grant that the deferred paid path keeps.
  Phase 06 no longer deletes or pseudonymizes `payment_orders` and has no `account_deletions` step;
  phase 11 G2 checks grant, revoke and one production `purchase_intent` instead of a purchase and
  refund.
- Idempotency: `aborted` is no longer a pilot answer; in-flight uses retryable `unavailable`; the
  "crash leaks one unit" acceptance is replaced by the sweeper.
- Rate limits: "expire on their own" is replaced by deletion by id in phase 06.
- Disclosure: the heuristic fallback and the "drop `origin`" time-box exit are removed from phase 03.
- Phase 09: "update streak/lastActive" in the server grant is replaced by client-owned streak;
  "drop all `review:` ops" is replaced by the receipt-based filter.
- Phase 05 dependency now lists 04 (module and intent event), and G2 is split into G2 (04) and G2b
  (05) so each gate matches its phase's target date.

No contradictions remain between plan.md and the phase files. Open questions 11-14 below can change
the size of phase 06 (legacy decks), phase 02's import note, and phase 07's extension work; none of
them blocks starting W0.

## Unresolved questions

1. **Answered 2026-09-23: no gateway until the business is registered.** Gateway choice, fees and
   registration type move to the deferred part of phase 04.
2. **Partly answered: 79,000 VND excludes VAT.** Still open: the VAT rate and how to show the final
   price (`displayPriceVnd`, a G2 precondition), and e-invoices once sales start. Ask an accountant.
3. **Refund policy** for paid Pro after registration. Proposed: full refund on request within 7 days;
   the owner decides. The pilot takes no payment, so nothing is refunded in the pilot.
4. **Answered: 2 XP per review, and the recap is fixed in phase 08.** Previously: **Base review XP.** The ledger grants 2 today; the recap shows 5 for Good. Proposed: keep 2 (a
   config value).
5. **Answered 2026-09-23 (red team #1):** story and translate do not use the card quota; they have a
   per-account daily allowance (Free 20, Pro 200) and a per-account spend share of about 20%.
6. **Pro quota period.** Proposed: Pro usage is counted per 30-day entitlement window; Free usage per
   calendar month in Asia/Ho_Chi_Minh.
7. **Payment records after account deletion.** Deferred with the gateway. Proposed then: keep order
   records with the pid instead of the uid for accounting; confirm the retention period with the
   accountant.
8. **Answered: App Check is enforced for Firestore or Auth,** and after red team #15 no App Check
   change ships in the pilot.
9. **Answered: staging calls the real model.**
10. **Analytics retention.** Proposed: 180 days, then Firestore TTL deletes events.
11. **Legacy shared decks.** Do shared decks without an ownership document exist in production?
    This decides how much of phase 06's deck step is exercised (reviewers' question).
12. **Spreadsheet import.** Does import call AI for rows that contain only a word? If so, "import
    still works after the quota runs out" is false, and those rows must either count against the
    quota or be saved without AI fields (reviewers' question).
13. **Extension worker retries.** Does the extension worker retry a failed job in a new page, and so
    with a new `operationId`? If yes, phase 07 passes the id through the job (reviewers' question).
14. **Answered: the same person, and no learners are recruited yet.** Previously: **Developer and founder.** Are they the same person? If yes, the W0 cut line and the reduced
    W0 interview count apply as written (reviewers' question).
