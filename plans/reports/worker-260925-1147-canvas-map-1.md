# Canvas behavior map — partition 1

## Status

Mapped all 25 assigned source/seed components in [`board-behavior-map-1.json`](../260925-1005-claude-design-workflow-recovery/evidence/board-behavior-map-1.json): 23 boards plus `CardStatesLight` and `Review`. Rows cover product entry, variants, actions and concrete phase task IDs, ready/empty/failure fixture needs, policy exceptions, and source evidence. Paired variants are included where declared by the inventory/source.

## Review notes

- Existing app navigation supports landing, today, library, catalog, progress, settings, study, quiz, story, spelling, match, and shadowing; placement is a lesson query. League, onboarding, pricing, web-word capture, and extension flows are not established as app routes by current navigation. Treat these as proposed destinations requiring the mapped phase work, not as existing routes.
- Source samples include fictional testimonials, ratings, pricing/trial claims, league standings, quotas, and performance metrics. Map rows flag these for approved/sourced fixtures or replacement. Commerce and motivation boards remain required; business/policy gates determine activation and copy, not whether their behavior is excluded.
- `AnimeOnboarding` depicts a trial CTA, `AnimeReveal` and `DlgStreak` depict XP/freeze/repair rewards, and `AnimeLeague` uses fictional rankings and punitive promotion/demotion language. These require policy-aligned, supportive behavior/copy in their listed phase tasks.
- Shadowing and placement samples imply result data/capabilities. Runtime should use real recording/evaluation capability and non-mutating placement diagnostics; do not fabricate metrics or persist placement changes.
- `CardStatesLight` has only light seed variants in this assignment; the separately named dark card-state source is outside partition 1.

## Validation

Parsed the JSON and checked 25 rows, required fields, and action fields. Confirmed referenced phase task IDs against the recovery plan, including 11.1 in `phase-11-reminders-and-ai-progress.md`. No missing behavior/task gap was identified in this partition. No product source files were changed.
