# Increment 6 text conversation acceptance - 2026-09-05

Status: locally accepted; no deployment, migration, catalog publication or
external rollout performed.

## Decision

Increment 6 is complete as a bounded text-only conversation slice. It extends
the existing authenticated `generateVocabulary` AI callable and static dialogue
surface without adding a provider, Course/Scenario model, scheduler, review
write, speech assessment or durable transcript store.

## Reconciliation map

| Requested behavior | Existing seam | Delivered boundary |
| --- | --- | --- |
| Text conversation | `src/lib/gemini.ts` → `generateVocabulary` | One `conversation` action with existing Auth/App Check, retry and error handling. |
| Mission content | `CardData`, canonical course/scenario seams | A five-card projection; no parallel Course/Scenario domain. |
| Session lifecycle | No conversation runtime | Local model with six learner turns, twelve messages, alternating history and active/completed/failed states. |
| AI safety and cost | Functions validation, AI config and budgets | Exact fields, strict non-truncating limits, JSON data-only prompt framing, 24-call conversation scope, owner/service budgets and bounded output schema. |
| Learning evidence | `SkillEvidenceV4` production source | Optional deterministic `text-production` candidate only for exact target-word use; no persistence, FSRS rating or pronunciation claim. |
| Offline/error UX | Protected AI capability | Deterministic offline failure, retained retry message, in-flight guard and safe malformed-response failure. |

## Contract and product limits

- One to five target cards, six learner turns maximum, ten history messages per
  request and twelve session messages maximum.
- Learner and provider text are bounded at the client and rejected at the
  Functions boundary when oversized; oversized provider fields are never
  silently truncated.
- Turn six is completed by both transport and reducer even if the provider
  returns `sessionComplete: false`.
- The UI renders the immutable `session.mission` snapshot, so live library-card
  changes cannot make displayed targets diverge from the request/evidence.
- Static AI dialogue generation remains unchanged. No microphone, voice,
  pronunciation, phoneme, accent, fluency, prosody or native-like assessment
  was added.

## Independent review disposition

| Axis | Result |
| --- | --- |
| Correctness | PASS after fixing strict output/request rejection, sixth-turn completion and mission snapshot rendering. |
| Security/trust boundary | PASS; Auth/App Check and owner/service quotas remain authoritative, prompt data is bounded/JSON-encoded, and no conversation path writes protected learning state. |
| Architecture | PASS; existing callable, budget, CardData and SkillEvidence seams are reused; no parallel conversation or Course/Scenario domain. |
| Accessibility | PASS for visible Back/Close controls, labelled textarea, role log/live updates and keyboard-native form controls. |

## Local verification

| Gate | Result |
| --- | --- |
| Full root Vitest | Passed: 205 files, 1,804 tests. |
| Full Functions Vitest | Passed: 219 tests; 19 Firestore integration tests skipped because emulator-backed tests are opt-in. |
| Focused Increment 6 tests | Passed after final fixes: app parser/transport/panel plus Functions validation; correctness review reported 32 app and 34 Functions focused tests, security review reported 63 focused tests. |
| Root TypeScript check | Passed: `npm run lint`. |
| Functions lint/build | Passed: `npm --prefix functions run lint`; `npm --prefix functions run build`. |
| Production app build | Passed: `npm run build`; immutable `dist/health.json` generated. |
| Catalog verification | Passed: `npm run catalog:verify` (218 tests). |
| Dependency audit | Passed: `npm run verify:audit`; no high/critical findings. |
| `git diff --check` | Passed. |
| Firestore Rules/integration gate | Not run to completion: local environment has no Java runtime (`Process java -version exited code 1`). |

## Residual scope

Conversation session IDs are intentionally stateless and transcripts remain
component-local for this increment. A future cross-device or abuse-resistant
session policy would require a signed server session token and explicit durable
retention policy. Provider retention/telemetry remains governed by deployment
configuration and provider terms; this change does not add learner-audio or
transcript persistence.

This acceptance does not authorize or claim schema migration, Rules change,
dependency update, catalog publication, staging run, production deploy, traffic
change or rollback exercise. Existing unrelated untracked planning/archive
files were left untouched.
