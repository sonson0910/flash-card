# Execution team contract

Working directory: `/mnt/Projects/startup/flash-card`. Timezone: Asia/Saigon (UTC+07). User language: Vietnamese; code follows repository conventions. Reports: `/mnt/Projects/startup/flash-card/plans/reports/`.

User authorized parallel implementation using GPT-6 Luna with max reasoning. Root owns integration, global catalogs/extraction, plan status, shared files, review gates and commits. No deploy, cloud writes, credential access, production data, reset, clean, or revert. Agents do not commit, spawn further agents, or run competing global builds/extractors. You are not alone in this workspace; preserve all existing edits and accommodate peers. Report a required cross-owner edit instead of making it.

Read `~/.claude/rules/development-rules.md`, this plan's `scope-and-decisions.md`, `acceptance-contract.md`, and your assigned phase before editing. Coding uses installed `ak-cook` and `ponytail:ponytail` full: use existing patterns and smallest correct implementation, but never reduce explicitly requested scope. No `--yagni` requested. Only root writes agentmemory. Do not re-read the entire historical conversation or irrelevant phases.

All product Canvas screens, including new workflows, must be integrated. Only direction-selection demos are excluded. Paired theme boards and chosen seed references are required. Missing existing behavior creates an implementation task; it is not permission to omit a screen. Business/backend gates retain required tasks. Production behavior uses real data; deterministic fixtures belong only to tests. Visual acceptance compares app directly with unchanged Canvas, not merely app-owned screenshot baselines.

Phase 01 completed at `47a1bdc`, phase 02 at `6098ada`, phase 03 at `b6eda01`. Phase 04 is open; phase 08 code/test proceeds in parallel under explicit owner authorization. Existing later-phase patches remain preserved and unaccepted until their gates. Source of truth: Canvas under `docs/design/sonflash-redesign/canvas/`; inventory contains 122 components/boards and 219 artboards.

| Agent | Current exclusive ownership |
|---|---|
| creator_controller | Intake controller/hooks/pipeline + new creator model; no UI/runtime. |
| creator_dialog | CreateCardDialog and its local styles/tests; consumes creator model. |
| share_visual_finish | Library screen/overview/grid/filter/view model and local styles/tests; no tools/overlays. |
| course_projection_contract | Flashcard and flashcard components/styles/tests; editor callback integration. |
| system_visual_closure | cardEdit components/model/styles/tests; no Flashcard or practice edits. |
| course_index_backend | Library management/extractor/import dialogs after exact path handoff; original course backend handed to root. |
| course_index_repository | Course index repository and cardRepository + direct tests. |
| courses_profile_port | Course profile DTO, adapters, transactional Functions persistence + focused tests. |
| card_language_contract | Language/POS contracts handed off; exclusive Rules and Rules tests integration now. |
| course_index_review | Read-only review of course index backend/repository and evidence gaps. |

Root owns runtime integration, study pause/resume, Functions callable registration, shared config/catalogs, phase logs, heavy verification and commits. Rules ownership is temporarily delegated exclusively to card_language_contract. Each file boundary is further specified in the task messages; no agent may broaden it without coordination.

Controller owns AppRuntime, AppRuntimeBoundary, LibrarySession identity projection and its fixtures, shared types/config, catalog extraction, integration, global checks and commits. Other agents are available for review and tests after the writer announces a stable handoff. Local code/test of phases 08–10 before G1 is authorized by the owner; their code dependencies still apply, and deployment remains prohibited.

Each task has exclusive output files given in the delegate prompt. Keep reports concise with file/line evidence, actual commands/results, remaining requirements. Missing/skipped/timeout is not PASS. Track/stop processes you start; do not kill another session's process. Markdown only in project `plans/` or `docs/`.

End response:

```text
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Summary: one or two sentences
Concerns/Blockers: optional
```
