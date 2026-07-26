# Spec: Smart Flashcards

## Objective

Turn the current visual flashcard into a learning system that schedules reviews from review history, supports multiple active-recall directions, gives honest speech-recognition feedback, exposes richer vocabulary context, and remains usable with keyboard and assistive technology.

The upgrade must remain backward compatible with the existing Firebase cards. Missing fields are normalized at read time; no destructive migration is required.

## Assumptions

- Modern evergreen browsers are the target.
- Firebase remains the source of truth for signed-in users and local storage remains the offline source for signed-out users.
- Existing `easy | good | hard | unrated` values remain readable, while new reviews use `again | hard | good | easy` ratings.
- Desired retention defaults to 90%.
- AI-generated enrichment fields are optional so legacy cards continue to render.
- Web Speech Recognition is presented as transcript matching, not phoneme-level pronunciation assessment.

## Tech Stack

- React 19, TypeScript, Vite
- Firebase Auth and Firestore
- Motion for card transitions
- Vitest for pure scheduling, scoring, normalization, and recall tests
- `ts-fsrs` for the review scheduler

## Commands

- Development: `npm run dev`
- Tests: `npm test -- --run`
- Type check: `npm run lint`
- Build: `npm run build`
- Dependency audit: `npm audit --omit=dev`

## Project Structure

- `src/components/Flashcard.tsx`: card orchestration and flip interaction
- `src/components/flashcard/`: focused card UI components
- `src/lib/reviewScheduler.ts`: FSRS adapter and review history
- `src/lib/speechMatch.ts`: deterministic transcript matching
- `src/lib/recall.ts`: active-recall presentation logic
- `src/lib/cardNormalization.ts`: legacy/current schema boundary
- `docs/specs/`: behavior specifications
- `docs/plans/`: implementation plans

## Code Style

```ts
export function scoreSpeechMatch(target: string, transcript: string, confidence = 0): SpeechMatchResult {
  return { score: 0, confidence, matchedWords: [] };
}
```

- Pure domain logic lives in `src/lib` and is covered by unit tests.
- UI components receive typed props and do not directly mutate persistence.
- New Firestore fields are optional at the component boundary and normalized before use.

## Testing Strategy

- Unit tests for FSRS mapping, review-log creation, transcript scoring, recall prompts, and legacy normalization.
- Type checking for all component contracts.
- Browser verification for flip, keyboard operation, mode switching, and review controls.
- Existing pagination and image tests must continue to pass.

## Boundaries

- Always: preserve legacy cards, bound Firestore reads, validate AI output, keep secrets ignored by git.
- Ask first: destructive Firestore migration, authentication-flow changes, deployment of new cloud infrastructure.
- Never: generate images with Gemini, expose new secrets, remove existing learning data, or fetch an unbounded library for normal rendering.

## Success Criteria

- A review produces a scheduled due date and an append-only review record.
- Four ratings are available: Again, Hard, Good, Easy.
- Study mode supports English→Vietnamese, Vietnamese→English, image→word, listening→word, and cloze prompts with typed self-checking.
- Speech feedback uses similarity plus recognizer confidence and is labeled “Speech match”.
- Generated cards can store part of speech, CEFR, example, collocations, synonyms, antonyms, register, and common mistake.
- The flip surface works with pointer, Enter, and Space and exposes its state to assistive technology.
- Card visuals and low-power behavior remain intact.
- Tests, type checking, build, and production dependency audit pass.

## Open Questions

- Phoneme-level pronunciation scoring requires a dedicated speech-assessment provider and is intentionally outside this client-only upgrade.
- Personalized FSRS parameter optimization can be added after sufficient review logs exist; initial scheduling uses the library defaults.
