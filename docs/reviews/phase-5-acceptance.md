# Phase 5 acceptance record

Date: 2026-08-04

Result: accepted for local implementation. Production release remains outside
the authorized scope.

## Delivered behavior

- Today is the default destination in the four-part Today/Paths/Vocabulary/Progress shell.
- A deterministic, unique, bounded daily plan orders due, weak and new cards.
- Recognition, active recall, listening, spelling, cloze and sentence building
  share one reducer and require explicit FSRS rating after feedback.
- Placement uses 6–12 evidence-backed cards and never writes review, XP, mastery
  or catalog unlock state.
- Progress has URL state plus honest loading, cached, error and empty outcomes.
- Legacy Quiz, Spelling and Story remain executable through More practice.
- Lesson review commands retain one operation ID across device/cloud retries,
  reject stale owners and never advance on a failed publication.

## Independent review closure

Architecture review verified lazy lesson/placement chunks, Progress load/error
state, URL cleanup and legacy practice handoff. Runtime/security review verified
owner-bound sessions, stale request protection, a 32-entry owner-scoped retry
cache and end-to-end operation IDs. Accessibility review verified focus changes,
language metadata, non-color feedback, chart semantics, axe, 320px reflow and
200% text without clipped navigation labels. All three final reviews reported no
Critical or Required findings.

## Verification

| Gate | Result |
| --- | --- |
| TypeScript | Pass |
| App unit tests | 807/807 pass |
| Functions tests | 25/25 pass |
| Catalog validation | 27/27 pass; no publication |
| Chromium E2E | 40/40 pass |
| WebKit E2E | 39 pass, 1 project-policy skip |
| Production build | Pass |
| Initial JavaScript | 278,821/280,000 bytes gzip |
| App composition boundary | 593/600 lines |
| CodeGraph impact review | Daily workspace boundary reaches AppViewStage only |
| High/critical dependency audit | Pass |
| Firestore emulator rules | Blocked: Java runtime unavailable |

The Firestore emulator result is not counted as a pass. It must be rerun in a
release-capable environment with Java before deployment. No deployment or
catalog publication was performed during Phase 5.
