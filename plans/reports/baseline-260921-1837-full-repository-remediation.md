# Protected remediation baseline

- Captured: 2026-09-21, Asia/Ho_Chi_Minh
- Branch: `fix/apple-device-performance`
- HEAD: `067b2a24e3b327aac48ce8594db99b6d656b7de1`
- `git diff --check`: pass
- No stash, reset, clean, commit, push, deploy, or live database mutation was performed.
- Production export status: unavailable on this host because `gcloud` is not installed. A verified export and restore-access check remain mandatory before rollout.

## Pre-existing dirty content hashes

```text
47c0dacebca9f56c9020b68584470dfc51f07650a3719904e98f4b447a5dd003  .codegraph/.gitignore
f4d910a24fc238982ba7943485200b420414ad540eafa1a5fdd009307375093c  e2e/accessibility.spec.ts
532090191468d2463d283efe1c886ebba961fbcc4a9c13a41b2a1c8771fcbd7e  e2e/app-shell-remediation.spec.ts
8672d266ff43e39a7d08d12a251ff9cb3c66205d7fd554faa736fbce9ad7fc66  e2e/app.spec.ts
2f58421522a6f5c1568db4dba4af218dc04adad4cd6923ab131de6b6cb85ec64  e2e/catalog-workspace.spec.ts
a0c7a55b507470b4f86f5aa711b86cb83919c80e9e3f78fc5b94df15dae69d1c  e2e/phase5-learning.spec.ts
e0dd0b4a81baa1a03343145b9ea4884c8ea7aca468754ba2e376351cf5816015  extensions/lingoflash/tests/app-bridge.node.mjs
799ec5e12fca17b7728197ed898a9273d001a0f8d5b385fe21ab30ce912f4b0e  scripts/release-artifact.test.mjs
f38ff494257ef1f32aae2b41f4f611aceb2f7be5063d926da3a3f4c8306c45ac  scripts/release-workflows.test.mjs
2af91f68303371079bf541f6daf9c7b4675c4e82274f87c260644fa6780ce5eb  src/components/Flashcard.test.tsx
c0a8e4fba8240990e2ad31503aac5f150017dd61a57ba2d683fb1c029291222a  src/components/Flashcard.tsx
ef82a75c16e4ddca2758e15be53facb38d4cb55fe0fc43701f790672de94aac3  src/components/shell/LibraryManagementMenu.tsx
3527d80449220201ddc0ad307e1faec1112e629bd66d06435f47b22ce25b822e  src/components/ui/UndoToast.test.tsx
1f01b08631fb93293f0bd22a1046e1829ea6c06567a702dc5a12ca9b7a569da8  src/components/ui/UndoToast.tsx
5a81b58b1eb525d87f99beda9b8eab3bf491f620af3915d0b3430b1d0984bbfb  src/index.css
90d7206f27abca21ea93e478d5321ae7af068a02295d399aea9cd76ca54d0aee  src/lib/useZenGlassMode.test.ts
05a12ab45248e86ec6306d3640dd3e2292e7d0c07186ef23917f97954961ef2d  src/lib/useZenGlassMode.ts
5e7aa5d129be80aa836dcb1ffb5793b1e74a0bba205a52dc3f22d0da5ac25047  src/themeTokens.test.ts
15fddae3b88532242d44f3831ab2784ba9fdcadcc2743f330a6c88ccfa07d774  docs/superpowers/plans/2026-09-04-repository-remediation.md
3527d80449220201ddc0ad307e1faec1112e629bd66d06435f47b22ce25b822e  src/components/ui/UndoToast.test.tsx
90d7206f27abca21ea93e478d5321ae7af068a02295d399aea9cd76ca54d0aee  src/lib/useZenGlassMode.test.ts
50598b501e0bf2ee806172df5e1bd64297fe8a62286d6dca801f7ec6d3da02cb  zen-preview.html
```

The source plan files and `.serena/` metadata were created by the preceding review/planning workflow and remain preserved. Their hashes are available in that session's command evidence; implementation agents must not delete or replace them.

## Baseline execution

- PASS: `git diff --check`, root lint, Functions lint, Functions unit tests/build.
- Functions unit result: 211 passed, 19 skipped; skipped Firestore integrations remain unverified.
- EXPECTED FAIL: extension timeout contract (`38_000` implemented, `135_000` required); the checker after `&&` did not run.
- EXPECTED FAIL: repository Firebase pin (`15.23.0` implemented, `15.29.0` required).
- RUNNER GAP: `scripts/release-artifact.test.mjs` imports Vitest and cannot be invoked directly with `node --test`.
- EXPECTED FAIL: root audit has one high `js-yaml` advisory; Functions audit after `&&` did not run.
