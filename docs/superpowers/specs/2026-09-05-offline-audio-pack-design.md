# Offline audio packs (Increment 10) — design note

Date: 2026-09-05

## Reconciliation

The existing path is a published catalog lesson (`CatalogMediaClipV1`) parsed
by the catalog validators, checked against the trusted source-asset registry,
and rendered by `ListenMvp`.  The current player uses the clip's same-origin
relative `path`; it does not persist media or learner state.  This increment
adds a small window-side Cache Storage manager as an optional playback seam.
It does not add a second catalog cache, a service worker, a Firestore entity,
or a download control.  Catalog UI can expose install/remove only after a
real published pack manifest is delivered by the catalog pipeline.

## Contract

`OfflineMediaPackManifestV1` is an untrusted, exact-key JSON envelope:

```text
{ manifestVersion: 1, id, catalogId, releaseId, title, createdAt,
  assets: [{ clip: CatalogMediaClipV1, sha256, attribution }], totalBytes }
```

The manifest is bounded to 1–50 audio assets and 50 MiB total.  Asset ids and
paths are unique; `totalBytes` must equal the sum of parsed clip byte lengths.
Each `sha256` is the SHA-256 digest of the fetched derivative bytes.  The
`attribution` field is the exact registry attribution text (or `null` when no
attribution is required), so delivery remains explicit and reviewable.
Every clip is revalidated with the existing catalog parser and content-rights
references.  Installation then evaluates the trusted registry for commercial
use, derivatives, rehosting, worldwide territory, source revision/checksum,
expiry/revocation, and attribution delivery.  Draft, unreviewed, unknown,
prohibited, restricted, or revoked/expired assets fail closed.
The install seam also requires a trusted caller context marking the source
release `published` and `reviewed`; those values are not accepted from pack
JSON and are not a new persisted entity.

## Install and playback

Before any fetch, the manager asks an injectable `StorageManager` port for a
quota estimate.  Missing/invalid/insufficient quota fails closed and reports a
bounded oldest-first eviction suggestion; it never evicts another pack.
Install fetches only validated same-origin relative paths with
`credentials: same-origin`, `redirect: error`, an abort timeout, and bounded
streaming reads (including the existing 1,024-read runtime guard).
Content-Type, Content-Length, byte count, and SHA-256 must all match before a
response enters Cache Storage.  Quota preflight reserves a bounded allowance
for the pack marker and metadata.

Each install is serialized with the native Web Locks API under one
`sonflash-offline-media-packs-v1` lock.  Assets are written to one unique
candidate cache; after metadata is verified, an active marker in the offline-
pack index is written last.  The marker contains the parsed manifest and
immutable cache name, so a failed replacement leaves the old active
marker/pack intact and the candidate is deleted.  List reads and validates
markers; corrupt markers and unreferenced candidate caches are
ignored/deleted only inside the `sonflash-offline-media-packs-v1` namespace.
Explicit `remove` is the only eviction path.  Cached resolution verifies the
active marker and returns the exact cached response when the clip matches.

`ListenMvp` receives an optional resolver.  It prefers a resolved cached
response by creating an object URL, revokes that URL on lesson change/unmount,
and falls back to the existing online relative path if cache APIs fail.  No
learner data or audio is persisted outside Cache Storage, and no published
pack means no learner-facing install control yet.

## Web app metadata

`public/manifest.webmanifest` only describes the installable shell using the
existing SVG/192px PNG icons, `/` id/start URL/scope, standalone display, and
the current SonFlash theme colors.  It does not claim a complete offline app
shell and does not add a service worker or custom install prompt.
