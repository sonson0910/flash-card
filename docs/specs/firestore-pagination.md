# Spec: Firestore Pagination for Low-End Devices

## Objective

Load a bounded card page from Firestore so a library with tens of thousands of cards does not block or exhaust a low-end browser. Preserve filtering, totals, study flows, mutations, export, and bulk deletion without treating the visible page as the whole library.

## Tech Stack

- React 19 and TypeScript
- Firebase Auth and Cloud Firestore 12
- Vite 6
- Vitest for deterministic pagination/query-state tests

## Commands

- Install: `npm ci`
- Test: `npm test -- --run`
- Type-check: `npm run lint`
- Build: `npm run build`
- Development: `npm run dev`

## Project Structure

- `src/lib/cardRepository.ts` — deep card-query module and Firestore adapter
- `src/lib/cardQuery.ts` — pure query-state and cursor helpers
- `src/App.tsx` — UI caller holding only the visible cloud page
- `src/components/Flashcard.tsx` — visible card rendering
- `docs/specs/` — feature specifications
- `docs/plans/` — implementation plans

## Code Style

```ts
const page = await cardRepository.fetchPage({
  userId,
  pageSize: 9,
  cursor,
  filters,
});
```

Use explicit domain names, immutable state updates, cursor pagination, bounded reads, and user-facing error messages. Avoid offsets and hidden full-collection reads.

## Testing Strategy

- Unit-test cursor/page state, filter normalization, and legacy ordering behavior.
- Type-check and production-build after each implementation slice.
- Browser-test first page, next/previous navigation, filtering, creation, and deletion.
- Use Firestore aggregate queries for counts; do not test Firebase SDK internals.

## Boundaries

- Always: limit startup queries, reset cursors when filters/order change, preserve owner-only Firestore paths.
- Ask first: deploy Cloud Functions, change authentication, or migrate production data destructively.
- Never: use Firestore offsets, commit API keys, infer an empty collection from an empty filtered page, or load the complete cloud library on startup.

## Success Criteria

- Initial cloud load reads no more than 10 card documents.
- React holds no more than one visible cloud page plus cursors during library browsing.
- Next/Previous pages use Firestore cursors and totals use aggregate count.
- Cloud cards are not mirrored wholesale to localStorage.
- One bounded page may be cached so quota/network failures degrade to a usable local view with request backoff.
- Server-supported filters reset pagination and return correct bounded pages.
- Study/quiz/spelling/story use explicit bounded practice queries.
- Export and clear-all page through Firestore only when invoked.
- Legacy cards are not silently lost.
- Tests, type-check, build, and audit pass.

## Open Questions

- Full substring search across Vietnamese translations requires a dedicated search index; this change supports normalized word-prefix search.
- Rebuilding rich per-category summaries for legacy data requires an explicit maintenance action or backend job and is not performed at startup.
