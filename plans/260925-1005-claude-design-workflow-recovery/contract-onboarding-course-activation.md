---
title: "Contract — activate the course selected in onboarding"
status: proposed; owner approval required before implementation
---

# Activate the onboarding course

The onboarding journey creates the selected target course at “Start learning”. When `profile/courses` is absent, the server currently synthesizes legacy English as active and preserves it after creating Korean, Chinese or Japanese. The selected course is saved but the app opens English. A fix based only on `snapshot.exists` is race-dependent: a concurrent course creation can commit before the onboarding transaction retries, leaving the other course active.

## Proposed request contract

Extend only the existing `createCourse` request with optional `activateOnCreate?: boolean`, default `false`. It is not a persisted profile field. The onboarding journey and incoming-share creation send `true`, because each flow must leave the selected language pair active; ordinary course-switcher creation keeps the default. Server parsing validates that the value is a boolean and rejects unknown fields as before. Existing callers and deployed clients remain valid.

Within the existing profile transaction, after validating target uniqueness and the four-course limit, `activateOnCreate: true` sets `activeCourseId` to the newly created course ID whether the stored profile was absent or another course was created concurrently. `false` preserves the current active course, or uses the newly created course only if no active course exists. The synthetic legacy-English course remains in `courses`. A conflicting second create of the same target retains the existing `course-exists` result; this contract does not redefine idempotency. When different activation requests race, the last committed transaction sets the server-side active course. The current course controller does not subscribe to profile changes across tabs; a tab sees its own callable response and observes a later remote change only after explicit reload or a future reconciliation mechanism. This contract does not promise live cross-device synchronization.

## Cost and compatibility

The operation remains **one existing Firestore transaction read and one document write** per successful create. No extra read, write, query, subscription, document field, Rules change or callable invocation. Firestore may retry a contended transaction as it can today. The callable response remains the full course profile, so the controller updates the active course without a follow-up read.

## Acceptance

1. Absent profile + onboarding activation creates the selected target and makes it active while retaining legacy English.
2. Existing profile + ordinary switcher creation preserves its current active course; existing profile + onboarding or incoming-share creation selects the newly created course.
3. A transaction retry after a competing distinct-target create still activates the requested selection; tests cover the retry policy. The same-target conflict remains explicit. Other tabs require reload to observe a remote active-course change.
4. Chromium emulator onboarding finishes with the selected course active in both the UI and `profile/courses`; focused Functions/client tests and build gates pass.

## Approval gate

Owner approval is required before changing the callable request contract. This contract adds no Firestore I/O or persisted schema.
