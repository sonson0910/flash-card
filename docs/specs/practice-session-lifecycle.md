# Spec: Owner-safe Practice Session Lifecycle

## Objective

Deepen Practice Session into one owner-safe lifecycle shared by study, quiz,
spelling and story modes. The lifecycle owns session generation, preparation
exclusion, active-mode authority and review idempotency while React remains a
presentation adapter.

## Invariants

1. An owner change advances a monotonic generation. Work captured before an
   A -> B -> A transition is stale even when the owner ID matches again.
2. At most one practice preparation may run for the current generation. A
   second study, quiz, spelling or story request returns `busy` without starting
   another pool load or protected-function call.
3. Only a preparation from the current generation may activate a mode. Exactly
   one mode is authoritative for interaction at a time.
4. A study review may be claimed once while pending and once after it has been
   saved. A failed review releases the claim so the learner can retry.
5. Owner replacement and reset synchronously revoke active-mode and review
   authority. Late work may settle its underlying promise but cannot publish UI,
   award XP or mark a review saved for the new owner.
6. Public lifecycle method identities remain stable. React hooks must not own
   parallel owner-generation, preparation, active-mode or review-claim stores.

## Boundaries

- `practiceSessionLifecycle.ts` is framework-free and imports no React, DOM,
  Firebase, repository or browser-storage implementation.
- React hooks continue to own visible component state, keyboard/DOM behavior,
  delayed audio timer cleanup and effect subscription.
- Practice pool loading, Learning State persistence, XP publication, story
  generation and error presentation remain injected adapters.
- This phase does not change Firestore or IndexedDB schema, Rules, migrations,
  dependencies, catalog content or deployment configuration.

## Acceptance

- Lifecycle contracts cover owner A -> B -> A invalidation, cross-mode
  single-flight preparation, active-mode exclusion and review retry semantics.
- Study and game hooks use the shared lifecycle and no longer duplicate its
  mutable guards.
- Existing practice behavior, owner-race, accessibility and workspace contracts
  pass unchanged.
- Core verification, production build, bundle budget and diff validation pass.
