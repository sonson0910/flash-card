---
title: "Contract — spreadsheet import live result preview"
status: approved by owner 2026-09-28; implemented and verified locally
---

# Spreadsheet import live result preview

The `DlgImport` Canvas shows a progress bar, aggregate result counts and source-row errors at the same time. The current dialog renders either progress or a terminal result. The service publishes only `{ current, total, word }` during a flat import and discards source-row positions and rejected-row details. This contract covers the missing, truthful preview; it does not change accepted file formats, generation limits or persistence rules.

## Current trace

- `spreadsheetWorkbook.ts` creates `structuredRows` from the sheet matrix and `flatRows` from the same matrix. `sheet_to_json(..., blankrows: false)` currently discards physical blank-row positions.
- `spreadsheetModel.ts` drops invalid, duplicate and incomplete rows, then flattens words without a source coordinate.
- `spreadsheetImportService.ts` publishes per-word progress before each flat item and returns aggregate counts only when the operation ends. Structured rows use one `persistStructured` call without progress events.
- `cardIntakeController.ts` clears the prior result at start and publishes a new result only after the service resolves. `SpreadsheetImportDialog.tsx` makes progress and result panels mutually exclusive.

## Proposed in-memory contract

Extend the existing import feedback and result types; do not persist the preview in Firestore. The existing `current`, `total`, `word`, `status`, `reason` and summary fields remain. New fields are optional at the type boundary so existing callers can continue to send the current shapes; the UI treats omitted `pending` as zero and omitted `issues` as an empty list:

```ts
type SpreadsheetImportIssue = {
  sourceRow: number;
  sourceColumn?: number;
  word?: string;
  kind: 'invalid' | 'duplicate' | 'generation' | 'save' | 'pending';
  message: string;
};

type SpreadsheetImportSummary = ExistingSummary & { pending?: number };
type SpreadsheetImportProgress = ExistingProgress & {
  phase?: 'reading' | 'checking' | 'saving';
  summary?: SpreadsheetImportSummary;
  issues?: SpreadsheetImportIssue[];
  omittedIssues?: number;
};
type SpreadsheetImportResult = ExistingResult extends infer Variant
  ? Variant extends { summary: ExistingSummary }
    ? Omit<Variant, 'summary'> & {
        summary: SpreadsheetImportSummary;
        issues?: SpreadsheetImportIssue[];
        omittedIssues?: number;
      }
    : never
  : never;
```

`ExistingSummary`, `ExistingProgress` and `ExistingResult` mean the current exported interfaces/union, not new runtime types. The feedback port keeps `progress(value: SpreadsheetImportProgress | null)`; the controller keeps one `importProgress` state. The workbook/parser must preserve physical 1-based row numbers across blank rows and optional column numbers for flat lists. Fully blank rows are not candidates. Rejected structured rows, duplicate words, generation failures and save failures must produce issues before being discarded. The import service publishes cumulative progress after each classified or settled candidate; the controller forwards it only while the initiating owner session is active. A terminal result carries final counts and issues for the existing local error-report download. The dialog may show progress and partial counts/issues together, but labels them **results so far** until work ends. Empty or unavailable counts must not be presented as completed results.

For structured spreadsheets, detect the mode from supported headers, even if every row is invalid; do not fall back to treating header and translation cells as flat words. `total` counts nonblank data rows. Missing required fields or invalid identity count as `failed`; duplicate identity rows count as `skipped`. For flat lists, `total` counts nonblank text cells. Duplicate cells, AI-cap overflow and cells beyond the existing 200-unique-word processing limit count as `skipped`. The parser retains a source coordinate for each candidate. At every completed snapshot and terminal result, `total = created + reused + failed + skipped + pending`. During initial reading, `total` may be zero/unknown and the UI uses indeterminate progress. The visible issue list is capped at 5,000 entries and `omittedIssues` counts the rest, so a large flat sheet does not keep 200,000 issue objects in memory.

`Created` must mean a confirmed server save for **both** structured and flat imports. Both paths currently consume optimistic `persistCardsInternal` results while up to six cloud settlements run asynchronously. The import path must await or observe those **existing** settlement promises; a cloud duplicate becomes `reused`, and a definitive rejection becomes `failed`. An eight-second wrapper timeout does not cancel the callable, so a timed-out save becomes `pending` with a pending issue, never a definitive failure or `Created`. The service returns a `partial` result with unknown confirmation; the controller may then clear its operation token as it does today. Any later callable settlement is deliberately ignored by this completed import, including after close/reopen or retry. A later user-initiated import can use the existing server deduplication path, but the UI must not silently claim that the earlier pending save succeeded. Do not issue a new reconciliation read or automatic retry under this contract. Closing the dialog while the service is still running leaves that import active; switching account prevents the old import from publishing into the new session.

## Firestore cost and compatibility

| Action | Existing I/O | Incremental I/O |
| --- | --- | --- |
| Parse workbook and show preview | Browser memory only | **0 Firestore reads, writes, queries or subscriptions** |
| Save import items | Existing `createCardV2IfAbsent` / card updates | **0 additional requests**; observe existing settlements for confirmed counts and leave timeouts pending |
| Download error report | Browser-generated JSON | **0** |

No Firestore document schema, Rules or index changes. Do not expose raw exception text or spreadsheet contents beyond the selected local file's own preview/error report. The 5,000-issue cap and omitted count apply to preview and report alike.

## Acceptance before Canvas checkbox can close

1. A file with leading blank rows, duplicate words, missing translations and a failed save reports correct physical source-row issues; totals obey the accounting invariant in both modes.
2. Flat and structured imports show truthful aggregate counts while processing. Tests cover delayed successful saves, server deduplication, definitive rejection and timeout-with-late-success; the completed partial result keeps a timed-out save `pending` even if its callable later succeeds.
3. Close/reopen, account switch and retry do not mix snapshots from different import operations.
4. Error-report download includes the final issues; ready/progress/partial/failure dialog states pass keyboard, reduced-motion, accessibility and Chromium visual checks against `DlgImport-{light,dark}.png` on Classic/Crystal desktop and 390px.
5. Focused import/controller tests, Rules unaffected, and the full bundle and i18n gates remain green.

## Approval gate

Owner approved this contract on 2026-09-28. The implementation changes the import feedback/result contract and the meaning/timing of `Created` without adding Firestore I/O.
