# Spec: PR #21 remediation and safe release split

## Objective

Repair the failures reported by the `Quality gates / verify` run and split the
quota hotfix from the unrelated UI, Rules and extension work. The result must
keep card generation available during Firestore quota stalls, preserve exactly
once XP application for every client stream (including legacy accounts with
more than sixteen streams), enforce card epoch and XP metadata integrity in
Firestore Rules, and restore the protected migration evidence producer.

No production data, Hosting, Functions or Firestore Rules deployment is part of
the local implementation. Production mutation remains behind the protected
workflows and human approval described in `docs/runbooks/phase-6-rollout.md`.

## Assumptions

1. Firebase and Firestore remain the persistence boundary; no new dependency or
   alternate database is justified.
2. Existing `appliedXpSequenceByClient` data may contain 17–64 valid streams and
   must be preserved during migration.
3. A stream watermark must never be deleted while a retry can still arrive.
   Retirement is therefore logical metadata only; it never evicts the watermark.
4. The current quota hotfix commit `d1d1760` is independently releasable from
   `main` and will not be mixed with this Rules migration.

## Commands

```bash
npm run lint
npm test -- --run
npm --prefix functions run lint
npm --prefix functions test
npm --prefix functions run build
npm run test:rules
npm run build
npx playwright test e2e/app-shell-remediation.spec.ts e2e/card-uniqueness.spec.ts e2e/storage-resilience.spec.ts --project=chromium
npx playwright test e2e/app-shell-remediation.spec.ts e2e/card-uniqueness.spec.ts e2e/storage-resilience.spec.ts --project=firefox
npx playwright test e2e/app-shell-remediation.spec.ts e2e/card-uniqueness.spec.ts e2e/storage-resilience.spec.ts --project=webkit
npm run verify:audit
git diff --check
```

## Architecture and data protocol

### XP streams

- `users/{uid}/profile/stats` keeps XP, history and the bounded recent
  operation-id ledger;
  the legacy sequence map is read only as a one-time migration bridge.
- `users/{uid}/xp_streams/{clientId}` stores one validated watermark per stream:
  `schemaVersion`, `clientId`, `sequence`, and nullable `retiredAt`.
- New writes omit the legacy sequence map and set `xpStreamSchemaVersion: 2`.
- A first save that sees a legacy sequence map materializes every valid entry
  into stream documents in the same transaction that removes the map. It never
  slices the map or silently discards an entry.
- Load and save read the watermarks for the bounded pending-operation window;
  an evicted operation ID is still acknowledged from its stream watermark, so
  a pending queue cannot be resurrected by a reload.
- A pending operation with `sequence <= watermark` is acknowledged without
  changing XP, including when the stream is marked retired. A contiguous higher
  sequence advances the watermark and applies the delta once. A gap remains
  pending and is retried after its predecessor.
- Retirement is a monotonic marker: the watermark remains durable, retries at
  or below it are acknowledged, and a valid contiguous operation may continue
  without clearing the marker. No stream is evicted solely to satisfy a count
  limit.

### Firestore Rules

- Validate each stream document's key/value fields at the document boundary;
  this keeps the expression cost constant instead of unrolling 16/32/64 map
  entries in the stats rule.
- Treat a legacy stats map as a bounded, one-time client migration bridge:
  every entry is validated before materialization and invalid data fails closed
  for protected remediation. Rules v2 accepts only the exact stats schema, so
  new client writes cannot reintroduce the map.
- Cutover evidence requires a verified final delta; rollback evidence requires
  a verified rollback and explicitly cannot claim final-delta verification.
- Legacy cards may only be upgraded at epoch zero or their explicit current
  epoch. A card with no epoch can never become revision 1 of a later epoch.

## Testing strategy

1. Add failing browser regression tests for each CI symptom, then make the
   smallest UI/storage fix and run all three browser engines.
2. Add failing XP model/store tests for legacy accounts over 16 streams, stream
   17 synchronization, retired-stream retry idempotency and pending-queue
   convergence; then implement the v2 protocol.
3. Add Rules emulator tests for stream-document validation, legacy-map
   rejection, and the epoch resurrection regression.
4. Add source/workflow contract tests for the protected migration evidence
   workflow. Never upload plaintext production data or a plaintext rollback
   snapshot.

## Boundaries

- Always: validate untrusted Firestore data, preserve owner/epoch checks, keep
  pending XP until acknowledged, and run the narrow test before each broader
  gate.
- Ask first: production migration/apply, deployment, merge, credential changes,
  or destructive deletion of legacy data.
- Never: change `.slice(0, 16)` to `.slice(-16)`, bypass the Rules workflow,
  weaken App Check/rate limits, upload plaintext production data, or hide a
  failing test.

## Success criteria

- The five original E2E failures pass on Chromium, Firefox and WebKit.
- The quota hotfix remains independently cherry-pickable from `main`.
- Legacy accounts with 17–64 streams retain every watermark and the 17th stream
  can sync.
- A retry from a retired stream is acknowledged exactly once; pending XP does
  not remain stuck after migration.
- Rules reject malformed stream documents and legacy-card resurrection.
- `reservation-migration.yml` produces dry-run/apply/final-delta/rollback
  reports, retains only an external-KMS encrypted rollback artifact, and emits
  cutover-compatible evidence for final-delta or rollback runs.
- All local verification gates pass; no production release is claimed without
  protected workflow evidence.
