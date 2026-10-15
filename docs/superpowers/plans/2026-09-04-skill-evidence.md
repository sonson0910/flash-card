# SkillEvidence V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, learner-owned evidence ledger and rebuildable multidimensional skill state without changing v3/FSRS data or silently rating reviews.

**Architecture:** Keep the new domain in a framework-free `skillEvidence` feature. `SkillEvidenceV4` is an append-only event with one explicit skill signal; `SkillStateV4` is derived from those events and never stored as authoritative input. An owner-scoped command port validates and deduplicates events, while actual Firestore/IndexedDB wiring remains deferred until its schema and sync contract are separately approved.

**Tech Stack:** React/Vite TypeScript, Vitest, existing `SCHEMA_V3_LIMITS`, strict parser conventions, and `Map`/`Set` from the standard library. No new dependency.

**Spec:** `SONFLASH_EXECUTION_PLAN.md` §4, §5 “Increment 4 — SkillEvidence and SkillState”, and `docs/superpowers/specs/2026-09-03-adaptive-learning-core-design.md` §Failure behavior.

---

## Scope guard

- Do not add fields to `LearningStateV3`, `CardData`, review history, or FSRS.
- Do not add Firestore Rules/Functions, an IndexedDB store, a migration, a route, a provider, or a UI activity in this increment.
- Do not accept `rating`, `fsrs`, `pronunciation`, `fluency`, `accent`, `prosody`, or `intonation` as evidence payload fields.
- A browser transcript match is recorded only as `speech-match`; it cannot derive `pronunciation` or `production` state.
- Listening, context, production, and speech-match events do not expose an FSRS command.

## File map

- Create `src/features/skillEvidence/skillEvidenceModel.ts`: v4 contracts, strict parsers, append/idempotency helper, and deterministic state derivation.
- Create `src/features/skillEvidence/skillEvidenceModel.test.ts`: parser, ledger, browser-speech boundary, and derivation tests.
- Create `src/features/skillEvidence/skillEvidenceController.ts`: owner-scoped idempotent command port; no React/Firebase/browser imports.
- Create `src/features/skillEvidence/skillEvidenceController.test.ts`: no-owner, duplicate, conflict, owner-switch, and persistence-port tests.

## Dependency graph

```text
bounded contracts/parser
        ↓
append-only ledger + deterministic SkillStateV4
        ↓
owner-scoped idempotent command port
```

---

## Task 1: Define and validate SkillEvidenceV4

**Files:**
- Create: `src/features/skillEvidence/skillEvidenceModel.ts`
- Test: `src/features/skillEvidence/skillEvidenceModel.test.ts`

- [ ] **Step 1: Write failing parser tests.** Cover one valid record for each supported signal and reject unknown fields, missing fields, non-canonical IDs/timestamps, scores outside `0..1`, and payloads containing `rating` or `fsrs`.

```ts
const validEvidence = (source: SkillEvidenceSourceV4, skill: SkillEvidenceSkillV4) => ({
  schemaVersion: 4,
  id: 'evidence-1',
  ownerId: 'owner-1',
  target: { kind: 'lexeme', id: 'lexeme-1' },
  skill,
  source,
  activityId: 'activity-1',
  score: 0.75,
  observedAt: '2026-09-04T00:00:00.000Z',
});

it('keeps browser transcript matching outside pronunciation and production', () => {
  expect(parseSkillEvidenceV4(validEvidence('browser-speech-match', 'speech-match')))
    .toMatchObject({ skill: 'speech-match', source: 'browser-speech-match' });
  expect(() => parseSkillEvidenceV4({
    ...validEvidence('browser-speech-match', 'pronunciation'),
  })).toThrow(/source.*skill|speech-match/i);
  expect(() => parseSkillEvidenceV4({
    ...validEvidence('browser-speech-match', 'production'),
  })).toThrow(/source.*skill|speech-match/i);
});
```

- [ ] **Step 2: Run the RED check.**

Run: `npx vitest run src/features/skillEvidence/skillEvidenceModel.test.ts`

Expected: FAIL because the model and parser do not exist.

- [ ] **Step 3: Implement the smallest strict contracts and parser.** Reuse `SCHEMA_V3_LIMITS.id`/`shortText` for bounded identifiers and text limits, and use exact-key object parsing. The public shapes are:

```ts
export type SkillEvidenceSkillV4 =
  | 'recognition' | 'listening' | 'context' | 'production' | 'pronunciation' | 'speech-match';

export type SkillEvidenceSourceV4 =
  | 'recognition' | 'listening' | 'context' | 'text-production'
  | 'browser-speech-match' | 'pronunciation-provider';

export interface SkillEvidenceTargetV4 {
  readonly kind: 'lexeme' | 'chunk';
  readonly id: string;
}

export interface SkillEvidenceV4 {
  readonly schemaVersion: 4;
  readonly id: string;
  readonly ownerId: string;
  readonly target: SkillEvidenceTargetV4;
  readonly skill: SkillEvidenceSkillV4;
  readonly source: SkillEvidenceSourceV4;
  readonly activityId: string;
  readonly score: number;
  readonly observedAt: string;
}
```

`source` must map to exactly one skill: `recognition → recognition`, `listening → listening`, `context → context`, `text-production → production`, `browser-speech-match → speech-match`, and `pronunciation-provider → pronunciation`. Reject a source/skill mismatch. Require a canonical UTC ISO timestamp, non-negative bounded IDs without `/` or control characters, a finite score in `0..1`, and `schemaVersion === 4`.

- [ ] **Step 4: Run the GREEN check.**

Run: `npx vitest run src/features/skillEvidence/skillEvidenceModel.test.ts`

Expected: all parser/boundary tests pass.

- [ ] **Step 5: Commit the contract slice.**

```bash
git add src/features/skillEvidence/skillEvidenceModel.ts src/features/skillEvidence/skillEvidenceModel.test.ts
git commit -m "feat: add skill evidence v4 contract"
```

## Task 2: Add append-only ledger and rebuildable SkillStateV4

**Files:**
- Modify: `src/features/skillEvidence/skillEvidenceModel.ts`
- Test: `src/features/skillEvidence/skillEvidenceModel.test.ts`

- [ ] **Step 1: Write failing ledger/state tests.** Verify an identical evidence ID is a no-op, a reused ID with different content is a conflict, the ledger refuses to exceed its bound, and derived dimensions remain independent.

```ts
it('rebuilds independent dimensions without turning speech match into pronunciation', () => {
  const records = [
    parseSkillEvidenceV4(validEvidence('recognition', 'recognition')),
    parseSkillEvidenceV4({ ...validEvidence('listening', 'listening'), id: 'evidence-2', score: 0.25 }),
    parseSkillEvidenceV4({ ...validEvidence('browser-speech-match', 'speech-match'), id: 'evidence-3', score: 1 }),
  ];
  const state = deriveSkillStateV4(records, { kind: 'lexeme', id: 'lexeme-1' }, 'owner-1');
  expect(state.dimensions.recognition.score).toBe(0.75);
  expect(state.dimensions.listening.score).toBe(0.25);
  expect(state.dimensions.speechMatch.score).toBe(1);
  expect(state.dimensions.pronunciation.score).toBeNull();
  expect(state.dimensions.production.score).toBeNull();
});
```

- [ ] **Step 2: Run the RED check.**

Run: `npx vitest run src/features/skillEvidence/skillEvidenceModel.test.ts`

Expected: FAIL because ledger/state helpers do not exist.

- [ ] **Step 3: Implement bounded append and deterministic derivation.** Add:

```ts
export interface SkillEvidenceLedgerV4 {
  readonly schemaVersion: 4;
  readonly ownerId: string;
  readonly records: readonly SkillEvidenceV4[];
}

export interface SkillDimensionStateV4 {
  readonly score: number | null;
  readonly observations: number;
  readonly confidence: number;
  readonly lastObservedAt: string | null;
}

export interface SkillStateV4 {
  readonly schemaVersion: 4;
  readonly ownerId: string;
  readonly target: SkillEvidenceTargetV4;
  readonly asOf: string | null;
  readonly dimensions: Readonly<{
    recognition: SkillDimensionStateV4;
    listening: SkillDimensionStateV4;
    context: SkillDimensionStateV4;
    production: SkillDimensionStateV4;
    pronunciation: SkillDimensionStateV4;
    speechMatch: SkillDimensionStateV4;
  }>;
}

export function appendSkillEvidence(
  ledger: SkillEvidenceLedgerV4,
  evidence: SkillEvidenceV4,
): { readonly status: 'appended' | 'duplicate'; readonly ledger: SkillEvidenceLedgerV4 };

export function deriveSkillStateV4(
  records: readonly SkillEvidenceV4[],
  target: SkillEvidenceTargetV4,
  ownerId: string,
): SkillStateV4;
```

Use a fixed `maximumRecords` (512) and reject overflow rather than silently dropping learner history. `appendSkillEvidence` accepts an identical existing ID as `duplicate`, but throws a named conflict error when the ID's canonical content differs. `deriveSkillStateV4` filters only the supplied owner/target, takes the latest eight events per dimension ordered by `(observedAt, id)`, averages their scores, reports observation count, uses `min(1, count / 5)` confidence, and leaves unseen dimensions as `{ score: null, observations: 0, confidence: 0, lastObservedAt: null }`. `asOf` is the latest observed timestamp, so rebuilding from the same ledger is deterministic and needs no wall clock.

- [ ] **Step 4: Run the GREEN check.**

Run: `npx vitest run src/features/skillEvidence/skillEvidenceModel.test.ts`

Expected: parser, ledger, and state tests pass.

- [ ] **Step 5: Commit the ledger slice.**

```bash
git add src/features/skillEvidence/skillEvidenceModel.ts src/features/skillEvidence/skillEvidenceModel.test.ts
git commit -m "feat: derive multidimensional skill state"
```

## Checkpoint: contract and derivation

- [ ] `npx vitest run src/features/skillEvidence/skillEvidenceModel.test.ts` passes.
- [ ] No import references `reviewScheduler`, `LearningStateV3` mutation, Firestore, or browser globals.
- [ ] Browser speech-match evidence cannot populate pronunciation or production dimensions.

## Task 3: Add learner-owned idempotent command seam

**Files:**
- Create: `src/features/skillEvidence/skillEvidenceController.ts`
- Test: `src/features/skillEvidence/skillEvidenceController.test.ts`

- [ ] **Step 1: Write failing command tests.** Cover no active owner, successful append, same-owner duplicate replay, same-ID conflicting payload, and owner switching while an append is pending.

```ts
it('does not publish a pending result after the active owner changes', async () => {
  let owner: string | null = 'owner-1';
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const command = createSkillEvidenceController({
    persistence: {
      activeOwner: () => owner,
      append: async () => { await pending; return 'appended'; },
    },
  });
  const result = command.record(validEvidence('recognition', 'recognition'));
  owner = 'owner-2';
  release();
  await expect(result).resolves.toMatchObject({ status: 'stale-owner' });
});
```

- [ ] **Step 2: Run the RED check.**

Run: `npx vitest run src/features/skillEvidence/skillEvidenceController.test.ts`

Expected: FAIL because the command port does not exist.

- [ ] **Step 3: Implement the owner-scoped port and controller.** Define:

```ts
export interface SkillEvidencePersistencePort {
  activeOwner(): string | null;
  append(evidence: SkillEvidenceV4): Promise<'appended' | 'duplicate'>;
}

export type SkillEvidenceCommandOutcome =
  | { readonly status: 'appended' | 'duplicate'; readonly evidence: SkillEvidenceV4 }
  | { readonly status: 'no-active-owner' | 'stale-owner' };

export interface SkillEvidenceCommands {
  record(input: unknown): Promise<SkillEvidenceCommandOutcome>;
}
```

`record()` must parse an input that excludes `ownerId`, attach only the current active owner, and reject an input-supplied owner field. Key in-flight/completed operations by `ownerId + evidence.id`; same-key identical payloads share/replay the result, while a different canonical fingerprint throws `SkillEvidenceConflictError`. Check the owner before and after the awaited persistence call. Do not expose an FSRS rating method. Retain at most 500 completed command outcomes and never truncate the evidence ledger itself.

- [ ] **Step 4: Run the GREEN check.**

Run: `npx vitest run src/features/skillEvidence/skillEvidenceController.test.ts`

Expected: all command tests pass.

- [ ] **Step 5: Commit the command seam.**

```bash
git add src/features/skillEvidence/skillEvidenceController.ts src/features/skillEvidence/skillEvidenceController.test.ts
git commit -m "feat: add owner-scoped skill evidence commands"
```

## Checkpoint: command safety

- [ ] Same evidence ID is idempotent for one owner and cannot overwrite different content.
- [ ] Owner changes produce `stale-owner` and do not publish the old result.
- [ ] No learner event is converted to an FSRS rating.

## Task 4: Full verification and assurance review

**Files:**
- No production files unless a verification finding requires a narrowly scoped fix.

- [ ] Run the focused suite:

```bash
npx vitest run src/features/skillEvidence
```

- [ ] Run repository checks:

```bash
npm run catalog:verify
npm run lint
npm test -- --run
npm run build
git diff --check 1099ef5f60cfa824b6ffb2292b9f95cc37e198e1...HEAD
```

- [ ] Inspect the final diff and confirm no Firestore migration, Rules change, media ingestion, route, provider, FSRS mutation, or unrelated untracked file was touched.
- [ ] After verification, obtain separate read-only correctness and security reviews. Resolve every substantiated finding, rerun its focused check, and request re-review before completion.
- [ ] Record the final commit SHA and remaining limitation: actual durable learner-owned storage and Firestore sync require a separately approved schema/sync increment.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Evidence is written for the wrong learner | Cross-account data exposure | Bind owner from `activeOwner()`, reject caller owner fields, re-check owner after awaits. |
| Duplicate/replayed events inflate state | Incorrect skill progress | Stable evidence ID, canonical fingerprint conflict, idempotent append and bounded command cache. |
| Browser transcript match is mislabeled | Misleading pronunciation mastery | Source-to-skill mapping makes it `speech-match` only; no pronunciation/production mapping. |
| Ledger grows without bound | Storage/performance pressure | Hard maximum of 512 records; overflow fails closed instead of truncating. |
| FSRS and skill state become coupled | Scheduler corruption | Separate types/module and no FSRS/review imports or rating command. |

## Open questions intentionally deferred

- Firestore collection shape, Rules, offline queue, and cross-device merge semantics.
- Activity-specific evidence producers and Adaptive Learning recommendation consumption.
- Real pronunciation provider fields and calibration.

These belong after this bounded ledger/derivation seam and require their own migration and release review.
