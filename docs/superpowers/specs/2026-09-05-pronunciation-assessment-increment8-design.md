# Increment 8 — pronunciation assessment reconciliation

Date: 2026-09-05

Status: production-safe contract and server adapter only; Azure activation is
blocked until a separately provisioned server secret is available.

## Purpose

Define a dedicated pronunciation-assessment boundary without changing the
existing learning domain, review scheduler, or browser transcript fallback.
The boundary accepts one short, bounded audio request and returns honest
Azure-style metrics. It never labels a learner native-like and never invents a
missing score.

## Current flow reconciliation

| Existing path | Current responsibility | Increment 8 decision |
| --- | --- | --- |
| `PracticeScreen` → `ShadowingView` | Presents a target sentence and uses `scoreSpeechMatch()` against browser-recognised text | Keep as the separate transcript-match fallback; it never produces pronunciation evidence |
| `src/lib/speechMatch.ts` and `SpeechMatchFeedback` | Normalises text and displays word/sentence match | Do not reinterpret its score as accuracy, fluency, completeness, prosody, or phoneme quality |
| `SkillEvidenceV4` | Supports independent `pronunciation` / `pronunciation-provider` records | Leave persistence unwired; no fake record is emitted from browser matching or an unavailable provider |
| `SkillEvidenceController` | Already provides owner-bound, idempotent candidate command semantics | Future successful provider responses may use this boundary, but this increment does not create a Firestore/IndexedDB ledger |
| Functions `requireUser`, `onCall({ enforceAppCheck })`, `consumeBudget` | Authoritative Auth, App Check, owner/service quota and callable error boundaries | Reuse these guards for the dedicated non-AI provider callable; no second Gemini/AI callable and no client provider call |

## Azure decision and exact activation blocker

The short-audio REST adapter targets the pinned Azure contract: the
`Pronunciation-Assessment` header is base64-encoded JSON, requests are limited
to 30 seconds. This MVP accepts only PCM WAV at 16 kHz mono.
The scripted `en-US` response can contain accuracy, fluency and completeness,
with optional prosody and word/phoneme detail.

The Microsoft short-audio REST example represents
`EnableProsodyAssessment` as the JSON string `"True"` in that header, not as a
JSON boolean; the adapter follows that exact wire representation. See the
[official short-audio REST documentation](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short#pronunciation-assessment-parameters).

This workspace has neither `AZURE_SPEECH_KEY` nor the Azure region, and no
secret is bound in Firebase Functions. The implementation therefore defaults
to disabled/unavailable and intentionally does not call Azure, define a
Firebase secret that would prompt during deployment, log key material, or put
any key in the browser bundle. Production activation is blocked until an
operator separately provisions `AZURE_SPEECH_KEY` in a server-only secret
manager and `AZURE_SPEECH_REGION`, then explicitly enables the server feature
flag and deploy configuration. That provisioning/deployment decision is
outside this increment.

## Contract and bounds

The Functions-only `PronunciationAssessmentProvider` contract is deliberately
small. Its request has an `en-US` locale, bounded reference text and a
memory-only audio payload. Audio must use exactly `audio/wav` with
`pcm_s16le`, 16,000 Hz, mono. OGG is intentionally outside this MVP so its
duration cannot be independently bounded without adding an unneeded container
parser. Arbitrary URLs, other MIME types, malformed base64, mismatched byte
counts, empty audio, more than 30,000 ms, or more than 1 MiB are rejected
before provider access.

The WAV `data` chunk is the duration authority: with the fixed 32,000-byte
per-second PCM rate, `durationMs` must equal
`ceil(dataChunkBytes * 1000 / 32000)`. The data chunk is bounded to 960,000
bytes (30 seconds) and the declared duration is not trusted as a substitute
for that calculation.

The adapter sends the raw bytes only in the transient server request and never
writes them to IndexedDB, Firestore, logs, or an evidence record. There is no
browser audio-capture wiring in this increment, so no microphone recording is
retained on the client. A future capture UI must stop and discard its in-memory
buffer on owner change, unmount, result, and error.

The parsed result exposes `number | null` for accuracy, fluency, completeness,
and prosody. Word, word-score, phoneme, and phoneme-score fields are nullable
when Azure omits them. Missing fields stay `null`; no score is inferred, no
uncalibrated pass/fail threshold is applied, and no native-like/fluency claim
is shown.

The detailed REST response places the score fields directly on the selected
`NBest` and `Words` objects; the adapter reads that wire shape and leaves any
omitted field `null`.

## Server boundary

The non-AI `assessPronunciation` callable is protected by the existing Auth,
App Check, owner/service budget and bounded callable timeout. It only creates
the Azure adapter when the explicit server flag, key, and region are all
present. Otherwise it returns a truthful unavailable precondition without a
provider request. Provider timeouts, malformed responses, upstream failures,
and repeated failures are normalised and circuit-broken; retries are not
performed in the client.

No client module imports the provider or reads Azure configuration. No
pronunciation `SkillEvidenceV4` is persisted in this increment. A later
increment may turn only a successful, real provider response into a separate
owner-scoped `pronunciation-provider` candidate through the existing
idempotent controller after its storage/sync contract is approved.

## User truthfulness

The Shadowing surface continues to describe its feature as browser transcript
matching. When the provider is not activated, its status copy says that
pronunciation assessment is unavailable and that transcript matching remains
available; it does not claim pronunciation, phoneme, accent, fluency, prosody,
or native-like assessment.

## Verification target

Focused tests cover strict request parsing, MIME/audio/reference bounds,
base64 and response adversaries, nullable/missing fields, Azure header and
timeout behavior, unavailable/no-secret behavior, Auth/App Check/quota/error
source contracts, owner/stale-result safety at the future candidate boundary,
and truthful Shadowing copy. No test calls Azure. Then run focused and
Functions suites, root lint/full tests, app and Functions builds, and
`git diff --check`.
