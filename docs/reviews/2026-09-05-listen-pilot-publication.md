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

## Evidence inventory

| Requirement | Repository evidence | Decision |
| --- | --- | --- |
| Source identity and rights | `LISTEN_MVP_PILOT_REGISTRY_DATA` records three VOA URLs, `PUBLIC-DOMAIN`, rights evidence ID `voa-learning-english-rights-6861`, source revisions, attribution, and source checksums. | Source claims are retained and checked, but no independently retained rights/publication authority is present. |
| Derivative bytes | The generator reads all three files from `public/media/listen-mvp/`, checks their declared lengths, and hashes their actual bytes. | PASS for local integrity only; this does not establish publication. |
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

These values are recomputed from distributed bytes by
`scripts/listen-pilot-package.ts`; they are not trusted merely because they
appear in source data.

## Generator and fail-closed tests

`scripts/listen-pilot-package.ts` reuses the existing catalog parser/content
reference checks, Listen lesson parser, offline-pack manifest parser, rights
evaluator, and publication-digest check. It only returns a ready package when
a caller supplies a separately trusted reviewed/published binding. The
default build-content invocation supplies no such binding and therefore emits
the unavailable state.

The focused test covers:

- missing approval/unavailable output;
- deterministic three-asset manifest construction from an explicit test-only
  approval fixture;
- exact canonical publication digest mismatch;
- tampered derivative bytes;
- expired and revoked rights through the existing evaluator; and
- malformed transcript content.

The approval fixture is test data only. It is not publication evidence and is
never written to `public/media/listen-mvp/offline-pack.json`.

TDD evidence:

- RED: `npx vitest run scripts/listen-pilot-package.test.ts` failed before the
  generator existed (`Cannot find module './listen-pilot-package'`).
- GREEN: the same command passed 8/8 after the generator and tests were added.

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
| `npx vitest run scripts/listen-pilot-package.test.ts` | PASS | 8/8 tests; 1.02s real |
| `npx vitest run scripts/listen-pilot-package.test.ts src/features/listenMvp/listenMvpPilot.test.ts src/features/offlineMedia/offlineMediaPack.test.ts` | PASS | 35/35 tests; 1.03s real |
| `npm run lint` | PASS | 6.67s real |
| `npm test -- --run` | PASS | 216 files, 1,940 tests; 14.11s real |
| `npx vite-node --script scripts/listen-pilot-package.ts` | PASS | wrote unavailable output; 0.66s real |
| `npm run build` | PASS | Vite + build metadata + `dist/sw.js`; 4.04s real |
| `npm run verify:secrets` | PASS | 106 production files; 0.46s real |
| `npm run verify:bundle` | PASS | 70 JavaScript chunks; 0.66s real |
| `npm run verify:audit` | PASS | root/functions no high or critical vulnerabilities; 1.82s real |
| `git diff --check` | PASS | 0.03s real |

The build emitted the pre-existing `reviewScheduler.ts` dynamic/static import
warning. Existing full-suite stderr from simulated recovery paths and one
React `act(...)` warning remained expected; no test failed. No Functions,
Firestore Rules, browser, deploy, or publish command was needed because T08
changes only the pilot content generator/report and generated unavailable
content state.
