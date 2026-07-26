# Spec: Local Card Mirror

## Objective

Mirror each signed-in user's complete Firestore card library into browser IndexedDB. Firestore remains the source of truth; IndexedDB provides fast page and exact-word queries without rendering or retaining the full library in React state.

## Tech Stack

- React 19 and TypeScript
- Firebase Firestore
- Native IndexedDB, tested with `fake-indexeddb`

## Commands

- Type check: `npm run lint`
- Unit tests: `npm test -- --run`
- Browser tests: `npx playwright test`
- Production build: `npm run build`

## Project Structure

- `src/lib/cardMirror.ts`: IndexedDB interface and implementation
- `src/lib/cardRepository.ts`: Firestore batch streaming
- `src/App.tsx`: background sync and local-first integration
- `src/lib/*.test.ts`: mirror and sync contracts

## Code Style

```ts
const page = await queryMirroredCardPage(userId, filters, pageNumber, 9);
if (page) showImmediately(page);
void refreshTheVisiblePageFromFirestore();
```

Keep IndexedDB behind one deep module. React callers do not open transactions or know object-store details.

## Testing Strategy

- Unit-test exact-word lookup, pagination, user isolation, generation cleanup, and 100-card batch contracts.
- Preserve existing Firestore repository and browser E2E suites.
- Verify that only one page enters React state and full sync streams batches instead of accumulating the collection.

## Boundaries

- Always: isolate records by Firebase user ID; normalize cards at the storage boundary; sync in batches of 100; keep Firestore fallback while the mirror is incomplete.
- Ask first: deleting or merging historical duplicate Firestore documents.
- Never: render the complete library at once; expose one user's mirror to another; treat an incomplete mirror as authoritative.

## Success Criteria

- A complete library is persisted to IndexedDB in Firestore batches of at most 100.
- Page and normalized-word lookups work without loading all cards into React state.
- A complete mirror displays immediately, while the visible Firestore page refreshes in the background.
- New, updated, and deleted cards update the mirror.
- Interrupted sync keeps the last complete mirror and resumes safely without deleting valid cached cards.
- Existing lint, unit, E2E, and production build checks remain green.
