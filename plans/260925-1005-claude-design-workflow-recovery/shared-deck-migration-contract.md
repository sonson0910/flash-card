# Shared-deck migration contract

Phase 02 keeps the public shared-deck schema at version 2. This note isolates the mapping delta from the broader, still-uncommitted migration plan; no cloud migration is authorized or performed here.

| Source / destination | Required mapping |
|---|---|
| Public `shared_decks/{shareId}` | Preserve a complete, validated `targetLanguage` / `nativeLanguage` pair when supplied. Both fields are absent for unresolved legacy or mixed metadata. Do not invent an EN/VI pair. |
| Shared card projection | Preserve only explicit `origin: ai` or `origin: manual`. Missing origin stays unknown. Preserve an existing valid canonical identity tuple; do not infer provenance from the presence of generated-looking content. |
| Payload bytes, request fingerprint and migration digest | Include the complete optional language pair and safe card origin consistently. Replays must match the same normalized payload; migration verification must use the same exact shape. |
| Public / private boundary | Owner identity stays in `shared_deck_owners`. Public projection contains no owner, private note or extra fields. Expiry, quarantine and revoke behavior remain enforced. |
| Legacy migration / rollback | Current-shape recognition accepts the optional complete pair, rejects partial/invalid pairs and unexpected fields, and verifies the preserved pair during apply/cutover. No default metadata is added to legacy backups. |

Owning implementations: [request validator](../../functions/src/inputValidation.ts), [persistence](../../functions/src/sharedDeckPersistence.ts), [migration classifier/apply/verification](../../functions/src/legacySharedDeckMigration.ts), and [Rules](../../firestore.rules).

Evidence: [contract implementation](../reports/worker-260925-1229-share-contract.md), [independent review and fixes](../reports/reviewer-260925-1310-share-contract.md), and `evidence/phase-02-03-verify-core-retry.log`. The latter records 65 Rules tests and 39 Firestore integration tests passing; it exercises the integrated working tree, including the separate card-restore work of phase 03.

The final isolated phase-02 export passed 65 Rules and 38 emulator integration tests, without the separate restore changes. See [accepted source and verification](../reports/verification-260925-1653-shared-deck.md).
