# Execution team contract

Working directory: `/mnt/Projects/startup/flash-card`. Timezone: Asia/Saigon (UTC+07). User language: Vietnamese; code follows repository conventions. Reports: `/mnt/Projects/startup/flash-card/plans/reports/`.

User authorized parallel implementation using GPT-6 Luna with max reasoning. Root owns integration, global catalogs/extraction, plan status, shared files, review gates and commits. No deploy, cloud writes, credential access, production data, reset, clean, or revert. Agents do not commit, spawn further agents, or run competing global builds/extractors. You are not alone in this workspace; preserve all existing edits and accommodate peers. Report a required cross-owner edit instead of making it.

Read `~/.claude/rules/development-rules.md`, this plan's `scope-and-decisions.md`, `acceptance-contract.md`, and your assigned phase before editing. Coding uses installed `ak-cook` and `ponytail:ponytail` full: use existing patterns and smallest correct implementation, but never reduce explicitly requested scope. No `--yagni` requested. Only root writes agentmemory. Do not re-read the entire historical conversation or irrelevant phases.

All product Canvas screens, including new workflows, must be integrated. Only direction-selection demos are excluded. Paired theme boards and chosen seed references are required. Missing existing behavior creates an implementation task; it is not permission to omit a screen. Business/backend gates retain required tasks. Production behavior uses real data; deterministic fixtures belong only to tests. Visual acceptance compares app directly with unchanged Canvas, not merely app-owned screenshot baselines.

Current phase:01 baseline/source mapping. Existing UI and shared-deck patches are dirty and unverified; `evidence/implementation-start-ledger.json` freezes initial paths/hashes. No later-phase production edits until root opens that lane. Source of truth: Canvas under `docs/design/sonflash-redesign/canvas/`; inventory is122 components/boards and219 artboards.

Each task has exclusive output files given in the delegate prompt. Keep reports concise with file/line evidence, actual commands/results, remaining requirements. Missing/skipped/timeout is not PASS. Track/stop processes you start; do not kill another session's process. Markdown only in project `plans/` or `docs/`.

End response:

```text
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Summary: one or two sentences
Concerns/Blockers: optional
```
