# Increment 6 — bounded text conversation design

Date: 2026-09-05

Status: approved for implementation within the Increment 6 goal

## Purpose

Add a useful text-only scenario mission on top of the existing protected AI
dialogue path. A learner can send a bounded number of text turns using a small
set of vocabulary targets, receive a bounded reply and optional correction, and
finish with a deterministic session state. This is a contract and presentation
slice; it does not add voice, pronunciation scoring, durable transcript
storage, or a second learning scheduler.

## Reconciliation map

| Requested concept | Existing seam | Increment 6 decision |
| --- | --- | --- |
| AI conversation transport | `src/lib/gemini.ts` → protected `generateVocabulary` callable | Add one `conversation` action to the existing callable; reuse Auth, App Check, retry, and error classification |
| Static dialogue | `DialogueResult` / `generateDialogue()` | Keep unchanged for script generation; add a separate typed text-turn result |
| Mission target content | canonical `CourseV1`/`ScenarioV1` and existing `CardData` | Accept a bounded mission projection of target cards; no new Course/Scenario model or persistence |
| Session lifecycle | no existing conversation runtime | Add a framework-free reducer/model with max six learner turns, bounded history, and explicit `active/completed/failed` states |
| Quota | `getVocabularyAiBudget()` + durable owner/service limits | Give conversation its own budget scope and consume it before the provider call |
| Skill evidence | `SkillEvidenceV4` supports `production`/`text-production` | Expose only deterministic target-usage production observations; never emit FSRS, pronunciation, speech-match, or AI mastery claims |
| Offline behavior | protected AI requires network | Return a deterministic unavailable state; do not queue or fabricate a reply offline |
| Transcript storage | no approved durable schema | Keep session state in memory/component state and cap every request/response |

## Contract

The client sends:

```ts
{
  mission: { id, title, goal, cards: [{ id, word, translation }] },
  turn: 1..6,
  history: [{ role: 'user'|'assistant', text }],
  userMessage: string
}
```

The server validates exact fields, canonical bounded IDs/text, alternating
history, and `history.length === (turn - 1) * 2`. It treats mission content as
untrusted data in the prompt. The provider returns:

```ts
{
  reply: string,
  translation?: string,
  correction?: { original: string, corrected: string, explanation: string },
  sessionComplete: boolean,
  nextPrompt?: string
}
```

The parser rejects unknown fields and bounds all output. `sessionComplete` is
also forced true for the sixth learner turn. Target usage is derived locally
from the learner's own text rather than trusted from model output. No model
output is trusted as an owner identifier, rating, pronunciation assessment, or
persistence command.

## Evidence boundary

The client model can derive a `text-production` observation only when a target
word appears in the learner's own normalized message. The observation is an
optional output for a later owner-scoped evidence command; this increment does
not persist it. AI corrections are feedback, not evidence by themselves.

## Failure behavior

- signed-out, App Check-unavailable, quota, network, and provider failures use
  the existing protected-function error classification;
- malformed provider output becomes a safe failure, never a partial turn;
- a six-turn or oversized-history request is rejected before the provider;
- offline mode never calls the protected service and returns a deterministic
  `offline-unavailable` state;
- the UI keeps the last user message and actionable retry state after failure.

## Non-goals

- voice, microphone access, pronunciation/phoneme/prosody scoring, or speech
  provider adapters;
- FSRS ratings or automatic review writes;
- Firestore/IndexedDB schema, transcript persistence, migration, or sync;
- new Course/Scenario/Recommendation types or AI-driven recommendation;
- arbitrary user-supplied prompts, unbounded history, or raw learner-audio
  retention;
- changing the existing static AI dialogue generator behavior.

## Verification target

Focused tests cover strict request/output parsing, history/turn bounds,
provider payload shape, owner/quota wiring, reducer transitions, deterministic
production observations, offline/error states, and accessible text interaction.
Repository lint, Functions tests/build, root tests, app build, and diff review
remain required before the goal is closed.
