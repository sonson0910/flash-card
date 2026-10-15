# SonFlash Listen MVP pilot publication review — 2026-09-05 / updated 2026-09-06

## Decision

The three VOA *English in a Minute* clips are now available through the
published Listen runtime and the deterministic offline pack:

| Field | Value |
| --- | --- |
| Catalog | `english-core` |
| Release | `listen-pilot-2026-09-06` |
| Pack | `listen-mvp` |
| Reviewer identity | `operator-user` |
| Publisher identity | `operator-user` |
| Reviewed/published at | `2026-09-06T00:00:00.000Z` |
| Canonical manifest SHA-256 | `8207593069eb6b960a3fe7b8eadfb4f51c20b46909eeba4d4a2cad970fa39582` |

This publication is based on the user's operator attestation on 2026-09-06
and the VOA public-domain policy at
<https://learningenglish.voanews.com/p/6861.html>. It is not an independent
legal review or legal opinion. The same operator identity is retained for the
review and publication roles so that the authority is explicit rather than
implied.

`public/media/listen-mvp/offline-pack.json` remains a pure, exact-key
`OfflineMediaPackManifestV1`; reviewer/publisher authority is deliberately
bound by the trusted Listen publication constant and the generator result,
not by extra untrusted JSON fields.

## Runtime and artifact boundary

`src/features/listenMvp/listenMvpPilot.ts` now parses the approved registry and
exposes all three validated lessons through the production seam. The existing
Today route therefore selects only these published lessons. Candidate tooling
continues to use the same parser and source-bound data for deterministic
checks.

The three `.m4a` files were copied byte-for-byte from
`content/review/media/listen-mvp/` to `public/media/listen-mvp/`, where Vite
includes them in the deployable artifact. The package generator hashes those
actual public bytes, checks their declared lengths, preserves VOA attribution,
and rejects missing or unexpected deploy media.

## Evidence inventory

| Requirement | Repository evidence | Decision |
| --- | --- | --- |
| Source identity and policy basis | Each registry asset retains its exact VOA source URL, `PUBLIC-DOMAIN` license, `rightsEvidenceId: voa-learning-english-rights-6861`, source revision, source checksum, and the attribution `Voice of America Learning English`. | Accepted under the VOA policy URL and operator attestation; no independent legal review is claimed. |
| Derivative bytes | The generator reads the three public `.m4a` files, verifies declared lengths, and records their actual SHA-256 values. | PASS; bytes are copied from the reviewed source directory without transformation. |
| Transcript and lesson content | The existing Listen lesson parser validates audio kind, cue ordering/bounds, chunk rights references, known lexemes, comprehension options, and answer membership. | PASS for the published lesson data. |
| Review and approval | Trusted binding records reviewer and publisher identity `operator-user`, both timestamps, the canonical manifest digest, the policy URL, and the explicit operator-attestation wording. | PASS as operator attestation; this is not independent legal review. |
| Catalog/release identity | The binding and manifest use `catalogId: english-core` and `releaseId: listen-pilot-2026-09-06`. | PASS; identity is explicit and content-bound. |
| Publication binding | The package builder requires `published`/`reviewed`, matching catalog/release IDs, all three trusted identity fields, and the exact canonical digest before returning `ready`. | PASS; missing, stale, mismatched, or malformed authority remains fail-closed. |

## Verified source URLs and derivative checksums

| Clip | Source URL | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `break-the-news` | <https://learningenglish.voanews.com/a/7949136.html> | 733,106 | `e4006936e6366782549b54fc14737b643a85f211d0ebe5c6389d6b6b3d1ecd14` |
| `fair-and-square` | <https://learningenglish.voanews.com/a/7932782.html> | 733,123 | `cd5d6f044d8814da3fb91220f3225eb5895cd3627ad2862274a5edbe7981b166` |
| `on-the-ball` | <https://learningenglish.voanews.com/a/7990719.html> | 733,022 | `a29d51c904d752a3bc0c7ea324f53296fe649561a6aac337c852be82c1df4dd0` |
| **Total** | — | **2,199,251** | — |

All three lessons retain the source attribution in `lesson.sources` and in
the offline manifest asset records. The manifest's `assets` order is
canonicalized by clip ID, and its `totalBytes` is the sum of the three parsed
clip byte lengths.

## Generator and fail-closed checks

`scripts/listen-pilot-package.ts` reuses the existing catalog parser/content
reference checks, Listen lesson parser, offline-pack manifest parser, rights
evaluator, and publication-digest check. Its default package build reads the
public media and the trusted operator binding. Passing `publication: null`
still produces the unavailable state for diagnostic/test coverage; no caller
can turn a malformed or mismatched binding into a ready package.

`writeListenMvpPilotPackage` writes only the canonical manifest for a ready
result, preserving the existing offline-media contract. `verifyListenMvpPilotPackage`
rebuilds the package, compares the checked-in JSON byte-for-byte, and rejects
renamed, extra, or missing media in deploy output.

The focused tests cover:

- RED runtime and package assertions while the production seam was empty or
  publication was fail-closed;
- the approved three-asset manifest from actual derivative bytes;
- reviewer/publisher identity and exact canonical publication digest;
- missing approval, wrong digest, expired/revoked rights, tampered bytes, and
  malformed transcript data; and
- checked-in artifact drift and unexpected deploy media.

## Publication limitations

- Rights are recorded as a public-domain policy basis and operator attestation;
  no independent legal review, counsel opinion, or external rights database is
  asserted.
- The checked-in artifact proves deterministic local bytes and parser/evaluator
  acceptance. Hosting/deployment authenticity still comes from the trusted
  same-origin release process.
- Any source revision, policy change, revocation, or transcript correction
  requires a new operator approval, release ID, and canonical manifest digest.

## Verification record

| Command | Result |
| --- | --- |
| `npx vitest run scripts/listen-pilot-package.test.ts src/features/listenMvp/listenMvpPilot.test.ts src/features/listenMvp/listenMvpInteraction.test.ts src/features/dailyLearning/DailyLearningScreens.test.tsx src/features/listenMvp/ListenMvp.test.tsx` | PASS |
| `npm run verify:listen-pilot` | PASS |
| `git diff --check` | PASS |

The required focused command also exercises the existing Daily Learning and
Listen UI contracts. Broader build, Functions, browser, and deployment
verification are outside this Listen publication slice and are not represented
as completed here.
