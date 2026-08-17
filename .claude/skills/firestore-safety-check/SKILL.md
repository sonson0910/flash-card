---
name: firestore-safety-check
description: "Check SonFlash Firestore, Firebase Functions, client adapters, tests, and deployment boundaries against project-specific ownership and data-safety invariants."
user-invocable: true
when_to_use: "Invoke when changes affect Firestore Rules, Firebase configuration, callable Functions, card persistence, shared decks, indexes, migrations, owner epochs, or Firebase deployment workflows."
category: security
keywords: [firebase, firestore, rules, app-check, authorization, ownership, safety]
argument-hint: "[base-ref-or-revision]"
metadata:
  author: sonflash
  version: "1.0.0"
---

# SonFlash Firestore Safety Check

Review Firebase-facing changes against SonFlash's actual ownership, synchronization, and release invariants.

## Outcomes

Return one final outcome:

- `SAFE` — relevant invariants and executable checks passed.
- `HOLD` — required evidence or prerequisites are unavailable, stale, or not run.
- `BLOCKED` — a verified trust-boundary or data-integrity defect remains.

## Hard boundaries

- Findings and verification only unless the user separately requests remediation.
- Never deploy Rules, Functions, Hosting, indexes, or migrations.
- Never query or mutate production data.
- Never authenticate or change the active Firebase project merely to complete the review.
- Never replace emulator-backed Rules tests with source-pattern tests.

## Scope detection

Inspect the requested diff or revision, especially:

- `firestore.rules`
- `firestore.indexes.json`
- `firebase.json`
- `firestore.rules.test.ts`
- `firestoreRulesSource.test.ts`
- `functions/src/**`
- `src/lib/firebase.ts`
- card mutation, reservation, revision, tombstone, owner, replica, and shared-deck code
- `.github/workflows/*firebase*`, release, migration, and production workflows

If none of these boundaries are affected, explain why the check is not applicable.

## Required invariants

### Authorization and identity

- Default deny remains intact.
- Authentication and authorization are separate and both enforced.
- Every private read, create, update, and delete is owner-authorized.
- Client-controlled fields are never an authority source.
- Card document identity matches normalized owner/card identity.
- Public shared-deck payloads never expose private owner identity.

### Offline mutation protocol

- Cached owner epochs never authorize cloud mutation.
- Remote epoch verification occurs before writes become publishable.
- Revisions remain monotonic.
- Tombstones prevent stale resurrection.
- Reservation and card changes remain atomic.
- Pending operations are not acknowledged before cloud and local reconciliation succeed.
- Stale, future, duplicated, and retried operations have bounded deterministic behavior.

### Callable Functions

- Authentication and App Check remain enforced outside isolated emulators.
- Inputs are type-, shape-, length-, and cardinality-bounded.
- Rate limits remain effective.
- Secrets use protected server configuration and are not logged or bundled.
- Errors expose safe public details, not credentials, internal stacks, or owner data.
- Admin SDK transactions preserve reservations, revisions, tombstones, and ownership.

### Configuration and release

- Project ID, database ID, region, and runtime targeting are explicit.
- Required indexes match permitted queries.
- Rules deployment remains separate, evidence-bound, protected, and human-approved.
- No generic local or all-target production deployment path is introduced.

## Verification commands

Run source invariants when relevant:

```bash
npx vitest run firestoreRulesSource.test.ts
```

Run Java-backed Rules and integration tests only with Java 21:

```bash
npm run test:rules
```

If Java 21 is unavailable, report `BLOCKED / NOT_RUN`; do not report Rules as passing.

When Functions changed:

```bash
npm --prefix functions run lint
npm --prefix functions test
npm --prefix functions run build
```

Run focused application tests for changed mutation, replica, identity, or sharing modules. Explain test selection.

## Finding standard

For each verified finding provide:

- severity: `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW`;
- confidence;
- exact `file:line` evidence;
- affected trust boundary or invariant;
- concrete input/state/race sequence and wrong outcome;
- missing regression test;
- recommended remediation.

Reject abstract hardening advice that cannot produce a concrete failure in SonFlash's threat model.

## Report

Include scope, commands run, results, skipped/blocked checks, findings, positive controls, residual risks, and final `SAFE`, `HOLD`, or `BLOCKED`. List unresolved questions last.