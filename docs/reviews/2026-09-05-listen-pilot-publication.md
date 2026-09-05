# SonFlash Listen MVP pilot publication review — 2026-09-05

## Decision

The three-clip Listen MVP pilot is **unavailable** for offline publication at
this revision. The repository contains useful source and derivative claims,
but it does not contain the trusted evidence needed to create an installable
`OfflineMediaPackManifestV1`. No reviewer, publisher, approval digest, or
published catalog/release identity is invented here.

The deterministic content step generated
`public/media/listen-mvp/offline-pack.json` with this fail-closed state:

```json
{
  "status": "unavailable",
  "reason": "publication-evidence-missing"
}
```

The file also records the three verified local derivative checksums for
operator diagnosis. It is deliberately not a media-pack manifest and is not
installable by the existing offline-media parser/evaluator.

The candidate `.m4a` derivatives are retained under the non-deployable review
source `content/review/media/listen-mvp/`. They are no longer under `public/`,
so Vite cannot copy them into the hosted artifact. Their manifest paths remain
the intended future release paths (`media/listen-mvp/*.m4a`); only a future
trusted approved-release step may copy reviewed bytes into deployable output.

## Runtime boundary

The canonical production module, `src/features/listenMvp/listenMvpPilot.ts`,
exports an empty lesson set and a selector that returns `null` until a trusted
reviewed/published release is wired in. `DailyLearningWorkspace` imports only
that runtime-safe seam, so Today does not expose or play these candidate clips.
The candidate parser/data lives in `listenMvpPilotCandidates.ts` and is used
only by content tooling/tests. Listening UI copy is generic and does not claim
that a candidate clip is reviewed.

## Evidence inventory

| Requirement | Repository evidence | Decision |
| --- | --- | --- |
| Source identity and rights | `LISTEN_MVP_PILOT_REGISTRY_DATA` records three VOA URLs, `PUBLIC-DOMAIN`, rights evidence ID `voa-learning-english-rights-6861`, source revisions, attribution, and source checksums. | Source claims are retained and checked, but no independently retained rights/publication authority is present. |
| Derivative bytes | The generator reads all three files from `content/review/media/listen-mvp/`, checks their declared lengths, and hashes their actual bytes. | PASS for local integrity only; this does not establish publication. |
| Transcript and lesson content | The existing Listen lesson parser validates clip, transcript cue ordering/bounds, chunk references, and comprehension data. | PASS for structural validity only; no independent content-review record exists. |
| Review and approval | No trusted reviewer identity, content-bound review fingerprint, approval record, publication transition, or audit event exists for this pilot. | MISSING. |
| Catalog/release identity | The workspace registry keeps English unavailable with `catalogId: null` and `releaseId: null`; no approved release manifest is present. | MISSING. |
| Publication binding | No trusted `status: published`, `review: reviewed`, catalog/release binding, and canonical manifest digest exists outside generated content. | MISSING; package remains unavailable. |

The planning evidence is explicit that the repository has no reviewed VOA
derivative and no licensed, provenance-complete, independently reviewed
catalog. The code-level rights claims therefore cannot be promoted to a
published release by this generator.

## Verified local derivatives

| Clip | Bytes | SHA-256 |
| --- | ---: | --- |
| `break-the-news` | 733,106 | `e4006936e6366782549b54fc14737b643a85f211d0ebe5c6389d6b6b3d1ecd14` |
| `fair-and-square` | 733,123 | `cd5d6f044d8814da3fb91220f3225eb5895cd3627ad2862274a5edbe7981b166` |
| `on-the-ball` | 733,022 | `a29d51c904d752a3bc0c7ea324f53296fe649561a6aac337c852be82c1df4dd0` |
| **Total** | **2,199,251** | — |

These values are recomputed from the non-deployable review-source bytes by
`scripts/listen-pilot-package.ts`; they are not trusted merely because they
appear in source data.

The build previously counted 19,578,775 B of media, including 2,199,251 B of
candidate audio. After relocation, the build counts 17,379,524 B of media:
607,270 B images, 16,772,254 B video, and 0 B audio. This remains under the
existing 20,000,000 B media budget without weakening the gate.

## Generator and fail-closed tests

`scripts/listen-pilot-package.ts` reuses the existing catalog parser/content
reference checks, Listen lesson parser, and offline-pack manifest parser. Its
production package builder has no caller-supplied publication/approval input
and always emits the unavailable state while evidence is missing. The
test-only fixture builds a candidate manifest and invokes the existing rights
evaluator/publication-digest check directly; it cannot authorize production
output. `npm run verify:listen-pilot` recomputes the default output and checks
the checked-in JSON byte-for-byte. While publication is unavailable, that gate
also fails if the deploy output contains any entry under
`media/listen-mvp/` other than the non-installable `offline-pack.json`; this
catches renamed, hidden, and unexpected candidate media. `npm run build` runs
the gate after Vite and metadata generation.

The focused test covers:

- missing approval/unavailable output;
- deterministic three-asset manifest construction from an explicit test-only
  fixture;
- exact canonical publication digest mismatch;
- same-length tampered derivative bytes;
- expired and revoked rights through the existing evaluator; and
- malformed transcript content;
- checked-in artifact drift; and
- candidate audio rejection from a deploy output, including renamed media.

The publication fixture is test data only. It is not publication evidence and
is never written to `public/media/listen-mvp/offline-pack.json`; no production
API accepts it.

TDD evidence:

- RED: `npx vitest run scripts/listen-pilot-package.test.ts` failed before the
  generator existed (`Cannot find module './listen-pilot-package'`).
- RED: `npx vitest run src/features/listenMvp/listenMvpPilot.test.ts` initially
  failed because the runtime export contained three candidate lessons.
- GREEN: the focused runtime/content suite passed after the candidate-only
  module split and empty production seam were added.
- RED: the new deploy-output regression initially failed because
  `assertListenMvpPilotDeployOutput` was not implemented.
- GREEN: `npx vitest run scripts/listen-pilot-package.test.ts` passed after the
  gate was added and the candidates moved out of `public/`.
- RED: the renamed-file regression resolved unexpectedly before the directory
  scan (`promise resolved "undefined" instead of rejecting`).
- GREEN: the directory-level fail-closed gate passes the renamed-file
  regression and the complete package suite.

## Publication inputs still required

To produce a real installable pack, a trusted release process must supply:

1. retained authoritative source/rights evidence for each derivative,
   including expiry/revocation handling;
2. independent transcript/content review bound to the exact content;
3. an approved catalog and release identity; and
4. a trusted publication record containing `published`, `reviewed`, reviewer
   identity/time, and the digest of the canonical parsed manifest.

Until those inputs exist, offline audio must remain unavailable. This change
does not add UI, install behavior, or publication authority.

## Verification record

| Command | Result | Duration / count |
| --- | --- | ---: |
| `npx vitest run scripts/listen-pilot-package.test.ts src/features/listenMvp/listenMvpPilot.test.ts src/features/listenMvp/listenMvpInteraction.test.ts src/features/dailyLearning/DailyLearningScreens.test.tsx src/features/listenMvp/ListenMvp.test.tsx` | PASS | 50/50 tests; package suite 11/11, 0.58s Vitest duration |
| `npm run lint` | PASS | 6.90s real |
| `npm test -- --run` | PASS | 216 files, 1,943 tests; 14.11s Vitest duration |
| `npm run verify:listen-pilot` | PASS | byte-for-byte checked-in artifact and deploy-media gate; 0.50s real |
| `npm run build` | PASS | Vite + metadata + `dist/sw.js` + pilot gate; 4.90s real |
| `node --check dist/sw.js` | PASS | 0.00s real |
| `npm run verify:secrets` | PASS | 103 production files; 0.36s real |
| `npm run verify:bundle` | PASS | 70 JavaScript chunks; 17,379,524 B media raw; 0.90s real |
| `npm run verify:audit` | PASS | root/functions no high or critical vulnerabilities; 2.40s real |
| `git diff --check` | PASS | 0.00s real |

The build emitted the pre-existing `reviewScheduler.ts` dynamic/static import
warning. Existing full-suite stderr from simulated recovery paths and one
React `act(...)` warning remained expected; no test failed. No Functions,
Firestore Rules, browser, deploy, or publish command was needed because T08
changes only the pilot content generator/report, runtime availability boundary,
and generated unavailable content state.
