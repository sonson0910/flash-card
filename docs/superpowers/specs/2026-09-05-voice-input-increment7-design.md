# Increment 7 — push-to-talk transcript input design

Date: 2026-09-05

Status: approved for a small production-safe vertical slice

## Purpose

Add optional push-to-talk voice input to the existing bounded text
conversation. The browser converts a short utterance to text, the existing
text-conversation callable receives that transcript, and the existing audio
seam may read the provider reply. The feature is voice input/transcript only;
it does not claim pronunciation, phoneme, accent, fluency, or native-like
assessment.

## Reconciliation map

| Requested concept | Existing seam | Increment 7 decision |
| --- | --- | --- |
| Voice input | Browser Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`) | One small adapter boundary with support detection, start/stop, timeout, transcript and error lifecycle; no dependency or second provider |
| Conversation transport | `TextConversationPanel` → `sendTextConversationTurn()` → protected `generateVocabulary` callable | Submit the bounded transcript through the existing text request/session/owner/quota path |
| Reply audio | `src/lib/audio.ts` `playWordAudio()` TTS fallback | Reuse the existing browser speech-synthesis seam for an explicit “Read reply” action; do not persist or upload audio |
| Feature availability | Vite `import.meta.env` | Default off unless an explicit `VITE_ENABLE_VOICE_INPUT=true` build flag enables it; unsupported, denied, offline and disabled states retain the text textarea |
| Session ownership | Increment 6 owner-bound panel/transport | Stop recognition, invalidate the attempt and discard stale transcript on owner change or unmount |
| Usage accounting | Existing callable budget and `TextConversation` action | Browser speech recognition reports `unavailable` usage (no app-side provider meter); the resulting AI turn uses the exact existing callable quota semantics |
| Storage | No approved audio/transcript persistence seam | Keep recognition data in component memory only; never create a raw-audio blob, upload, persistence field, or schema |

## Why Gemini Live is not used

Firebase AI Logic Live Web API is a Preview API and its official documentation
states that it is not for production use. The final goal includes production
deployment, so this increment deliberately does not integrate or ship Gemini
Live Preview. Browser Web Speech recognition is used only as a transcript-input
adapter, while the authenticated/App Check-protected text callable remains the
sole AI boundary.

## Contract

The adapter exposes a minimal lifecycle:

```ts
{
  supported: boolean,
  start(): void,
  stop(): void,
  onTranscript: (text: string) => void,
  onState: (state: 'idle' | 'listening' | 'stopping') => void,
  onError: (error: 'denied' | 'timeout' | 'runtime' | 'unsupported') => void
}
```

The concrete browser adapter uses `SpeechRecognition` when available and
`webkitSpeechRecognition` as the browser's compatibility alias. It is
single-shot/push-to-talk: `continuous` is false, interim results are not
submitted, and a short timeout always stops the recognizer. A component-level
circuit breaker disables the control for the current panel/session after
repeated start/runtime failures, avoiding retry storms.

## UI and truthfulness

- Keep the existing labelled textarea and Send button visible and usable at all
  times; voice input only fills the textarea.
- The control is a keyboard-accessible push-to-talk button with visible states
  and a status message explaining “voice input / transcript”.
- On a final transcript, normalize and cap it at the existing 500-character
  learner-message limit before putting it in the textarea. The normal Send
  path performs the existing offline/auth/owner/session/quota checks.
- Recognition errors are actionable (`unsupported`, permission denied,
  timeout, temporary runtime failure) and never fabricate text.
- Reading a reply is opt-in and uses speech synthesis; it is not a
  pronunciation score or speech assessment.

## Lifecycle and safety

- The adapter stops on component unmount and on authenticated owner change.
- Each recognition run has a generation token. Late `result`, `error`, and
  `end` events from an old run cannot update the current owner/session.
- No raw audio is retained, serialized, persisted, or uploaded by the app.
  The browser's speech service may process recognition audio; SonFlash does not
  store a recording.
- Recognition is never started while offline, disabled, unsupported, already
  listening, or after the circuit breaker opens.
- Existing Auth, App Check, owner-bound transport, exact quota accounting,
  bounded text validation, FSRS, and evidence boundaries remain unchanged.

## Non-goals

- Gemini Live, streaming AI audio, raw microphone upload, or a new AI callable.
- Pronunciation, phoneme, accent, fluency, prosody, native-like, or speech
  mastery scoring.
- Course/Scenario models, scheduler changes, evidence storage, transcript
  persistence, migration, or new dependencies.

## Verification target

Focused tests cover adapter support/start/stop, transcript/error/timeout,
denied/offline behavior, circuit breaking, stale owner/unmount events, feature
flag and truthful copy, reply speech-synthesis seam, and text-conversation
transport reuse. Then run root lint, focused/full tests, app build, and
`git diff --check`; no package installation or dependency audit is needed.
