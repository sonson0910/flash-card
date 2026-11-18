# English Paths editorial draft

This candidate covers General, IELTS, and TOEIC with 15 ordered units per track.
It contains 300 lexemes, 300 track memberships, 45 English titles, 45 Vietnamese
titles, and one contextual bilingual example per lexeme. The General words come
from the existing foundation seed list, TOEIC from core, and IELTS from advanced.
The unit assignments and examples are new AI-assisted draft content.

The candidate is **not publishable**. Every record is marked `draft` and
`unreviewed`, with `NOASSERTION` for the license and no rights evidence. No
reviewer identity or approval digest has been manufactured. The manifest under
`source/` is a Catalog V2 source candidate, not a public release. The active
catalog registry is unchanged.

## Rebuild and validate locally

From the repository root:

```sh
npx vite-node scripts/generate-english-paths-draft.ts
npm run catalog:validate -- --input catalog/english-paths-draft/source/manifest.json
```

The generator reads the three track JSON files, checks 100 unique words and 15
nonempty units per track, creates stable lexeme and membership IDs, and runs the
strict source validator before writing JSONL and descriptors. The catalog CLI
then parses the on-disk files through the production operator path. Neither
command accesses Firestore or writes public release assets.

## Publication gate

An independent editor must check every English sense, Vietnamese definition,
example translation, unit title, unit assignment, and track fit. The rights
holder must establish and record the applicable permission or license for the
final content. After edits, the trusted catalog operator must bind review
evidence to the exact final content digest and approve the source digest using
its protected reviewer authority. `scripts/catalog-cli.ts` and
`src/features/catalogPipeline/catalogBuilder.ts` enforce this gate. Any edit
after review requires a new review. Release creation or deployment is outside
this draft's scope.

Preparing this draft adds **zero Firestore reads, writes, or queries**. The
existing approved Paths and Continue costs apply only if a release is later
published and installed.
