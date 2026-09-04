# Story Lesson v2 — design and reconciliation (2026-09-05)

## Scope

The existing practice path remains the only path: `PracticeScreen` renders
`StoryView`; `usePracticeSession`/`usePracticeGames` owns the ephemeral story
state; `generateStoryContext` calls the existing authenticated,
App-Check-protected `generateVocabulary` callable with the existing story
budget/quota. The result is not a catalog item and is not persisted.

## Contract and rollout

The existing `story` action is versioned inside the same callable. A legacy
array input is parsed as v1 and keeps the original v1 prompt, two-field schema,
and `{ story, translation }` response so an already-open client remains
compatible while Functions deploys first. The new client sends the exact
object `{ schemaVersion: 2, words }`; only that path returns the strict v2
lesson below. Unknown story versions and v2 fields are rejected. Both paths
use the existing story budget/quota.

`StoryInfo` evolves in place to one strict, bounded response contract:

```text
{
  title,
  segments: [{ english, vietnamese }],       // exactly 2–4
  comprehension: {
    question,
    options: [string, string, string],
    correctIndex: 0 | 1 | 2,
    explanationVi
  },
  grammar: { label, explanationVi, sourceSentence, prompt, acceptedAnswer },
  retellPrompt,
  targetPhrases
}
```

Every object has exactly the listed keys; required strings are non-empty and
are rejected (not truncated) when they exceed their field bound. The server
validates the model response before returning it, while the client validates
again before rendering. `targetPhrases` is bounded to five entries and, when
the requested words are available to the parser, each target contains a
requested word token. Normalized duplicate comprehension choices and targets
are rejected. Input remains at most five bounded words.

## Interaction and boundaries

Scenes are rendered as text with Vietnamese fallbacks and can be narrated one
at a time through the native browser speech-synthesis seam already in the
application. The active scene is highlighted while its utterance is speaking;
speech is cancelled on close, regeneration, unmount, or an owner/session reset.
Comprehension selection and grammar answer checking are deterministic and
local (case/whitespace-normalized for the accepted grammar answer). Retell is
only a local text draft. None of these interactions writes FSRS ratings,
`SkillEvidence`, cards, catalog data, or learner audio.

The request captures the current authenticated owner and uses the existing
owner-bound transport guard, so a late response cannot cross an account
boundary. AI output is ephemeral generated content; this feature makes no
licensing or publishability claim.

## Prompt/schema reconciliation

The existing story action and budget are reused. The prompt treats the JSON
word list as untrusted data and asks for the exact schema above, including
short English/Vietnamese scene pairs, one three-choice question, one grammar
transformation, a text retell prompt, and targets derived from the words.
There is no second callable, provider, `Chunk`/`Scenario` model, scheduler,
evidence store, or persistence layer.
