# Catalog Content Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the smallest strict contracts needed to describe rights-bound phrases and sentence-level audio context without changing the existing release, v3, FSRS, or learner-data paths.

**Architecture:** Keep `CatalogChunkV1` as the existing immutable release envelope. Add separate `CatalogContentChunkV1`, `CatalogMediaClipV1`, `CatalogTranscriptCueV1`, and `CatalogContentRightsV1` types in the catalog pipeline. Parsing remains pure and strict; reference validation accepts an already-parsed trusted source-asset registry and optional known lexeme IDs. No builder, cache, UI, Firestore, or media ingestion wiring is added until the next increment.

**Tech Stack:** TypeScript 5.8, Vitest 3, existing catalog contract/validation helpers, Web Crypto-independent pure validation.

---

## Scope and invariants

- `CatalogContentRightsV1` contains only a versioned registry reference and the exact source-asset SHA-256; license and permissions remain authoritative in the existing trusted registry.
- `CatalogContentChunkV1` is a phrase/collocation/formula/idiom record and is distinct from the existing release `CatalogChunkV1`.
- `CatalogMediaClipV1` supports `audio` and future `video`, but accepts only bounded same-origin relative paths and media metadata; it embeds ordered sentence-level cues.
- Cue order is non-overlapping and bounded by clip duration; gaps are allowed for silence.
- Parsed content references are not trusted until `assertCatalogContentReferences()` checks the trusted registry and, for chunks, supplied known lexeme IDs.
- Required attribution remains fail-closed in the existing publication evaluator; this increment does not invent an attribution surface.
- No migration, publish, deploy, external fetch, provider SDK, or learner-data write is in scope.

## Task 1: Add additive contracts and limits

**Files:**

- Modify: `src/features/catalogPipeline/catalogContracts.ts`
- Test: `src/features/catalogPipeline/catalogValidation.test.ts`

- [ ] **Step 1: Write failing type/shape tests** for a valid content chunk, rights reference, transcript cue, and audio clip fixture. Import the new parser names so the test fails because the contracts/parsers do not yet exist.
- [ ] **Step 2: Run the focused test**:

  ```bash
  npx vitest run src/features/catalogPipeline/catalogValidation.test.ts --reporter=verbose
  ```

  Expected: FAIL with missing content parser exports.

- [ ] **Step 3: Add only the bounded contracts and limits**:

  ```ts
  export type CatalogContentChunkKindV1 = 'phrase' | 'collocation' | 'formula' | 'idiom';

  export interface CatalogContentRightsV1 {
    readonly schemaVersion: 1;
    readonly registryVersion: 1;
    readonly sourceRef: string;
    readonly sourceAssetSha256: string;
  }

  export interface CatalogContentChunkV1 {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly language: string;
    readonly kind: CatalogContentChunkKindV1;
    readonly text: string;
    readonly lexemeIds: readonly string[];
    readonly contentRights: CatalogContentRightsV1;
  }

  export interface CatalogTranscriptCueV1 {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly clipId: string;
    readonly language: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly text: string;
  }

  export interface CatalogMediaClipV1 {
    readonly schemaVersion: 1;
    readonly id: string;
    readonly language: string;
    readonly mediaKind: 'audio' | 'video';
    readonly path: string;
    readonly mimeType: string;
    readonly byteLength: number;
    readonly durationMs: number;
    readonly contentRights: CatalogContentRightsV1;
    readonly transcriptCues: readonly CatalogTranscriptCueV1[];
  }
  ```

  Add these limits to `CATALOG_PIPELINE_LIMITS`: content text 512 characters, content lexeme references 16, MIME type 64, media bytes 25 MiB, media duration 15 minutes, transcript cues 512, and cue text 2,048 characters.

- [ ] **Step 4: Run the focused test again** and confirm the contract imports compile while behavioral parser tests remain the next RED slice.
- [ ] **Step 5: Commit**:

  ```bash
  git add src/features/catalogPipeline/catalogContracts.ts src/features/catalogPipeline/catalogValidation.test.ts
  git commit -m "feat: define catalog content contracts"
  ```

## Task 2: Implement strict parsers and trusted-reference checks

**Files:**

- Modify: `src/features/catalogPipeline/catalogValidation.ts`
- Test: `src/features/catalogPipeline/catalogValidation.test.ts`

- [ ] **Step 1: Add RED tests** covering:
  - unknown fields, empty/overlong phrase text, empty/duplicate/overlong lexeme IDs, malformed rights hash, and unsupported chunk kind;
  - cue IDs/clip IDs/languages, negative or non-integer times, `endMs <= startMs`, overlong cue text, overlapping/out-of-order cues, and cue end beyond clip duration;
  - media path traversal/absolute URL, MIME prefix mismatch, zero/over-limit byte length, zero/over-limit duration, and over-limit cue count;
  - missing registry asset, registry-version mismatch, source checksum mismatch/null, and missing chunk lexeme reference;
  - one complete valid audio clip and one valid chunk accepted.
- [ ] **Step 2: Run RED**:

  ```bash
  npx vitest run src/features/catalogPipeline/catalogValidation.test.ts --reporter=verbose
  ```

  Expected: the new content cases fail for missing parser/reference functions while the pre-existing catalog cases stay green.

- [ ] **Step 3: Implement the minimum pure functions** beside the existing catalog parsers, reusing `recordAt`, `stringAt`, `canonicalIdAt`, `languageAt`, `digestAt`, `relativePathAt`, `enumAt`, `integerAt`, `arrayAt`, and `uniqueArrayAt`:

  ```ts
  export function parseCatalogContentRightsV1(value: unknown): CatalogContentRightsV1;
  export function parseCatalogContentChunkV1(value: unknown): CatalogContentChunkV1;
  export function parseCatalogTranscriptCueV1(value: unknown): CatalogTranscriptCueV1;
  export function parseCatalogMediaClipV1(value: unknown): CatalogMediaClipV1;
  export function assertCatalogContentReferences(
    value: CatalogContentChunkV1 | CatalogMediaClipV1,
    registry: CatalogSourceAssetRegistryV1,
    knownLexemeIds?: ReadonlySet<string>,
  ): void;
  ```

  `parseCatalogContentRightsV1` validates the exact source checksum format. `parseCatalogContentChunkV1` requires at least one canonical lexeme ID. `parseCatalogTranscriptCueV1` validates integer millisecond ranges. `parseCatalogMediaClipV1` requires a `audio/*` MIME for audio and `video/*` for video, validates every cue against the parent clip, and enforces ascending non-overlapping cues within duration. `assertCatalogContentReferences` requires matching registry version/sourceRef/source checksum and, when a lexeme set is supplied, rejects any missing chunk reference. It must not infer permissions from the content object.

- [ ] **Step 4: Run GREEN**:

  ```bash
  npx vitest run src/features/catalogPipeline/catalogValidation.test.ts --reporter=verbose
  ```

  Expected: all existing and new validation tests pass.

- [ ] **Step 5: Commit**:

  ```bash
  git add src/features/catalogPipeline/catalogValidation.ts src/features/catalogPipeline/catalogValidation.test.ts
  git commit -m "feat: validate catalog content references"
  ```

## Checkpoint: contract slice complete

- [ ] `npx vitest run src/features/catalogPipeline/catalogValidation.test.ts src/features/catalogPipeline/catalogBuilder.test.ts`
- [ ] `npm run catalog:verify`
- [ ] `npm run lint`
- [ ] `npm test -- --run`
- [ ] `npm run build`
- [ ] `git diff --check 1099ef5f60cfa824b6ffb2292b9f95cc37e198e1..HEAD`
- [ ] Review confirms no changes to `CatalogChunkV1` release shape, v2/v3 schema, FSRS, cache, UI, Firestore, media ingestion, publication, or deployment.

## Review and delivery

- [ ] Request independent spec/quality review and security review of the complete diff.
- [ ] Resolve every Critical/Required finding and re-run the affected checks.
- [ ] Record the final SHA in `SONFLASH_EXECUTION_PLAN.md` and keep Increment 3 pending.
